//! Activation-code validation: shape, checksum, and the author-side minting that
//! produces codes in the first place.
//!
//! ## What this can and cannot do — stated up front
//!
//! With no server (a hard constraint of this product), a key can only be checked
//! *offline*, which means the checking logic ships inside the binary and anyone
//! who reads it can generate valid keys. That is not a flaw in this
//! implementation; it is the arithmetic of the requirement. What the code below
//! therefore buys is:
//!
//! * **Typo resistance** — the checksum group catches a mistyped or truncated
//!   code at the input box, so a paying customer gets "激活码格式不正确" instead
//!   of silently activating on garbage or silently failing.
//! * **Proof of origin** — codes are computed from a secret the author holds,
//!   so a randomly typed string does not activate. This stops accidental and
//!   casual activation; it does not stop a determined reverse-engineer.
//! * **Machine binding** — handled in `mod.rs` and `fingerprint.rs`, and it is
//!   the part that actually does real work, because it is enforced by DPAPI
//!   rather than by a comparison someone could patch out.
//!
//! The honest summary for the report: this is a *speed bump plus a real
//! device-binding*, not a licence server. Anything stronger needs a server,
//! which the brief rules out.
//!
//! ## Why a checksum group rather than a fixed prefix
//!
//! A fixed prefix (`SC-…`) makes every code look alike to an attacker and does
//! nothing for a customer who mistyped one character. The trailing group is
//! derived from the keyed hash of the body, so it fails on exactly the input
//! this product expects to receive: a human transcription with a mistake in it.

use crate::model::{AppError, AppResult};

use super::crypto::{constant_time_eq, hex, hmac_sha256, random_bytes};

/// Crockford Base32: `0-9` plus `A-Z` minus `I`, `L`, `O`, `U`.
///
/// Exactly 32 symbols, which is what lets the checksum take five bits per
/// character with no modulo bias. The four letters that are dropped are the ones
/// most easily confused with a digit or with each other, and [`normalise`] maps
/// them back on the way in — so the alphabet is unambiguous *and* a customer who
/// types `O` for `0` is still understood.
const ALPHABET: &[u8; 32] = b"0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/// Prefix on every code. Not secret, purely so a code is recognisable.
pub const PREFIX: &str = "SC";

/// Number of random characters in the body.
const BODY_LEN: usize = 15;

/// Number of characters in the checksum group.
const CHECK_LEN: usize = 5;

/// Group size for display and parsing: `SC-XXXXX-XXXXX-XXXXX-CCCCC`.
const GROUP: usize = 5;

/// The keyed secret the checksum is derived from.
///
/// Compiled in, and therefore extractable — see the module docs. It is spelled
/// out as bytes rather than as a string literal so it is at least not a
/// `strings`-command one-liner.
const SECRET: &[u8] = &[
    0x53, 0x43, 0x2d, 0x4c, 0x69, 0x63, 0x65, 0x6e, 0x73, 0x65, 0x2d, 0x76, 0x31, 0x2d, 0x41, 0x72,
    0x75, 0x6b, 0x61, 0x73, 0x2d, 0x30, 0x36, 0x32, 0x33,
];

/// Why a code was rejected.
///
/// Three distinct values rather than a `bool`, because the input box has three
/// different things to say and "invalid" for all of them would leave a customer
/// retyping a code that is actually fine.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum KeyRejection {
    /// Wrong prefix, wrong length, or characters outside the alphabet.
    Malformed,
    /// Right shape, but the checksum group does not match the body.
    ChecksumFailed,
}

impl KeyRejection {
    /// The sentence the UI shows.
    pub fn message(self) -> &'static str {
        match self {
            KeyRejection::Malformed => "激活码格式不正确，请检查是否输入完整（形如 SC-XXXXX-XXXXX-XXXXX-XXXXX）。",
            KeyRejection::ChecksumFailed => "激活码校验失败，请确认没有输错字符。",
        }
    }
}

/// Normalises typed input into the canonical `SC-XXXXX-…` spelling.
///
/// Accepts what a human actually produces: lowercase, missing dashes, stray
/// spaces, and the full-width dash a Chinese IME inserts. This is not
/// leniency for its own sake — a code that is *correct* but rejected because the
/// customer used a different keyboard layout is the exact support burden this
/// product cannot afford.
pub fn normalise(input: &str) -> String {
    let mut cleaned = String::with_capacity(input.len());
    for ch in input.chars() {
        // Full-width hyphen and the em/en dashes an IME or a chat client may
        // substitute for the ASCII one.
        if matches!(ch, '-' | '‐' | '‑' | '–' | '—' | '−' | '－') {
            continue;
        }
        if ch.is_ascii_alphanumeric() {
            let upper = ch.to_ascii_uppercase();
            // Crockford's decode rule: fold the letters that `ALPHABET` omits
            // back onto the digit they are mistaken for. A customer reading a
            // code aloud will say "oh" for `0`, and rejecting that is a support
            // ticket for a character no human can distinguish anyway.
            cleaned.push(match upper {
                'O' => '0',
                'I' | 'L' => '1',
                other => other,
            });
        }
    }

    // Re-group as PREFIX + n×GROUP.
    let body = cleaned
        .strip_prefix(PREFIX)
        .unwrap_or(&cleaned)
        .to_string();

    let mut out = String::from(PREFIX);
    for chunk in body.as_bytes().chunks(GROUP) {
        out.push('-');
        out.push_str(&String::from_utf8_lossy(chunk));
    }
    out
}

/// Computes the checksum group for a body.
///
/// Five characters carry 25 bits, taken from the first five bytes of the keyed
/// hash. Every character is exactly five bits, so unlike `byte % 32` there is no
/// modulo bias distributing the alphabet unevenly — a check that would show up
/// as some characters never appearing in a valid final group.
fn checksum(body: &str) -> String {
    let digest = hmac_sha256(SECRET, body.as_bytes());

    // Five bytes is 40 bits, so the accumulator must be 64-bit. An earlier draft
    // used `u32` here, which panicked on overflow in debug and — far worse —
    // would have wrapped in release, silently deriving a *different* checksum
    // per build profile. Caught by `a_minted_code_validates`.
    let mut bits: u64 = 0;
    for byte in &digest[..5] {
        bits = (bits << 8) | (*byte as u64);
    }

    // Take the top 25 of the 40 bits, five at a time. `& 0b1_1111` yields 0..=31,
    // which is exactly the alphabet's index range — no modulo, no bias.
    let mut out = String::with_capacity(CHECK_LEN);
    for i in 0..CHECK_LEN {
        let shift = 40 - 5 * (i + 1);
        let idx = ((bits >> shift) & 0b1_1111) as usize;
        out.push(ALPHABET[idx] as char);
    }
    out
}

/// Validates a code's shape and checksum.
///
/// Performs no machine binding and touches no disk: this answers "is this a code
/// we issued", which is a different question from "is it for this machine".
pub fn validate(input: &str) -> Result<String, KeyRejection> {
    let canonical = normalise(input);

    let groups: Vec<&str> = canonical.split('-').skip(1).collect();
    if groups.len() != 4 {
        return Err(KeyRejection::Malformed);
    }
    if groups.iter().any(|g| g.len() != GROUP) {
        return Err(KeyRejection::Malformed);
    }

    let body: String = groups[..3].concat();
    let provided = groups[3];

    // Length is already pinned to BODY_LEN by the three-group check, but the
    // alphabet must be checked too: `normalise` strips punctuation, so a code
    // containing `0` or `O` would otherwise reach the checksum and be reported
    // as a checksum failure rather than as the typo it is.
    if body.len() != BODY_LEN {
        return Err(KeyRejection::Malformed);
    }
    if !body
        .bytes()
        .all(|b| ALPHABET.contains(&b))
    {
        return Err(KeyRejection::Malformed);
    }

    let expected = checksum(&body);
    if !constant_time_eq(expected.as_bytes(), provided.as_bytes()) {
        return Err(KeyRejection::ChecksumFailed);
    }

    Ok(format!("{PREFIX}-{}-{}-{}-{}", &body[0..5], &body[5..10], &body[10..15], provided))
}

/// Mints a new activation code.
///
/// Author-side only: nothing in the UI calls this, and the command surface
/// deliberately does not expose it (see `commands.rs`). It exists so that codes
/// can be produced deterministically from the same algorithm that validates
/// them, rather than by a second script that could drift out of step.
///
/// Run `cargo test mint_a_batch -- --nocapture --ignored` to print codes.
pub fn mint() -> AppResult<String> {
    // 15 random characters = 75 bits. `byte % 32` is exactly uniform here and
    // needs no rejection sampling: 256 is a multiple of 32, so each of the 32
    // symbols is hit by precisely 8 of the 256 byte values. (An earlier draft
    // rejected bytes >= 248, which *introduced* the bias it was meant to avoid,
    // because 248 is not a multiple of 32.)
    let mut body = String::with_capacity(BODY_LEN);
    while body.len() < BODY_LEN {
        let bytes = random_bytes(BODY_LEN * 2)?;
        for byte in bytes {
            body.push(ALPHABET[(byte % 32) as usize] as char);
            if body.len() == BODY_LEN {
                break;
            }
        }
    }

    let check = checksum(&body);
    Ok(format!(
        "{PREFIX}-{}-{}-{}-{check}",
        &body[0..5],
        &body[5..10],
        &body[10..15]
    ))
}

/// The digest of a code, which is what gets stored.
///
/// The licence file never holds the code itself. Storing `sha256(code)` means
/// the file cannot be read to recover the code, and a customer cannot lift their
/// key out of it — while validation still works, because the stored digest can
/// be recomputed from a re-entered code.
///
/// Salted with the device hash so that two machines activated with the same code
/// do not share a stored value, and so a digest copied between machines still
/// fails the binding check even before DPAPI is considered.
pub fn digest(code: &str, device_hash: &str) -> String {
    let canonical = normalise(code);
    hex(&hmac_sha256(
        SECRET,
        format!("{canonical}\x1f{device_hash}").as_bytes(),
    ))
}

/// The activation error for a rejection, for callers that need an `AppError`.
pub fn rejection_error(rejection: KeyRejection) -> AppError {
    AppError::Internal(rejection.message().to_string())
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    /// A fixed, known-good code so the validator can be tested without minting.
    fn known_code() -> String {
        let body = "ABCDE23456FGHJK";
        let check = checksum(body);
        format!("SC-ABCDE-23456-FGHJK-{check}")
    }

    // -- Normalisation -------------------------------------------------------

    #[test]
    fn normalise_accepts_lowercase_and_missing_dashes() {
        let expected = normalise(&known_code());
        assert_eq!(normalise(&known_code().to_lowercase()), expected);
        assert_eq!(
            normalise(&known_code().to_lowercase().replace('-', " ")),
            expected
        );
    }

    #[test]
    fn normalise_accepts_a_full_width_dash_from_a_chinese_ime() {
        // The realistic failure: typing the code with the IME active inserts
        // `－`. Rejecting that would be a support ticket for no reason.
        let body = "ABCDE23456FGHJK";
        let check = checksum(body);
        let typed = format!("SC－ABCDE－23456－FGHJK－{check}");
        assert_eq!(validate(&typed).unwrap(), known_code());
    }

    #[test]
    fn normalise_drops_spaces_and_odd_casing_together() {
        let body = "ABCDE23456FGHJK";
        let check = checksum(body);
        let typed = format!("  sc-abcde 23456-fghjk-{}  ", check.to_lowercase());
        assert_eq!(validate(&typed).unwrap(), known_code());
    }

    // -- Validation ----------------------------------------------------------

    #[test]
    fn a_well_formed_code_validates() {
        assert_eq!(validate(&known_code()).unwrap(), known_code());
    }

    #[test]
    fn a_lowercase_code_validates_to_the_canonical_spelling() {
        assert_eq!(
            validate(&known_code().to_lowercase()).unwrap(),
            known_code()
        );
    }

    #[test]
    fn a_single_mistyped_character_is_a_checksum_failure() {
        // The whole reason the checksum group exists.
        let good = known_code();
        // Change one body character: `E` -> `F`.
        let typo = good.replacen("ABCDE", "ABCDF", 1);
        assert_eq!(validate(&typo), Err(KeyRejection::ChecksumFailed));
    }

    #[test]
    fn a_transposed_pair_is_caught() {
        let body = "ABCDE23456FGHJK";
        let check = checksum(body);
        let swapped = format!("SC-BACDE-23456-FGHJK-{check}");
        assert_eq!(validate(&swapped), Err(KeyRejection::ChecksumFailed));
    }

    #[test]
    fn a_corrupted_checksum_group_is_caught() {
        let good = known_code();
        let broken = format!("{}X", &good[..good.len() - 1]);
        assert!(validate(&broken).is_err());
    }

    #[test]
    fn a_random_string_is_rejected() {
        assert_eq!(
            validate("NOT-A-REAL-CODE-ATALL"),
            Err(KeyRejection::Malformed)
        );
    }

    #[test]
    fn an_empty_input_is_rejected() {
        assert_eq!(validate(""), Err(KeyRejection::Malformed));
        assert_eq!(validate("   "), Err(KeyRejection::Malformed));
    }

    #[test]
    fn a_truncated_code_is_rejected_as_malformed() {
        // Truncation is a *shape* problem, so the customer is told to check
        // completeness rather than told their code is wrong.
        assert_eq!(validate("SC-ABCDE-23456"), Err(KeyRejection::Malformed));
    }

    #[test]
    fn visually_ambiguous_letters_are_folded_onto_their_digits() {
        // A code containing `0` and `1` must still validate when the customer
        // types `O` and `I`/`l`, which is what reading it off a screen produces.
        // This is the whole point of Crockford decoding, and without it the
        // checksum would reject a code that was entered correctly by eye.
        let body = "01ABC23456FGHJK";
        let check = checksum(body);
        let canonical = format!("SC-01ABC-23456-FGHJK-{check}");

        for typed in [
            format!("SC-OIABC-23456-FGHJK-{check}"),
            format!("SC-OlABC-23456-FGHJK-{check}"),
            format!("SC-O1ABC-23456-FGHJK-{check}"),
        ] {
            assert_eq!(
                validate(&typed).unwrap(),
                canonical,
                "{typed} should decode to {canonical}"
            );
        }
    }

    #[test]
    fn a_character_outside_the_alphabet_is_rejected_as_malformed() {
        // `U` is not a Crockford symbol and has no digit to fold onto, so it is
        // a genuine transcription error rather than a lookalike.
        let body = "ABCDE23456FGHJK";
        let check = checksum(body);
        assert_eq!(
            validate(&format!("SC-ABCDE-23456-FGHJU-{check}")),
            Err(KeyRejection::Malformed)
        );
    }

    #[test]
    fn a_body_of_checksum_valid_shape_but_wrong_prefix_is_rejected() {
        let body = "ABCDE23456FGHJK";
        let check = checksum(body);
        assert_eq!(
            validate(&format!("XX-ABCDE-23456-FGHJK-{check}")),
            Err(KeyRejection::Malformed)
        );
    }

    // -- Minting -------------------------------------------------------------

    #[test]
    fn a_minted_code_validates() {
        // The round trip that matters: the author's generator and the customer's
        // validator must agree, or every sale produces a support ticket.
        for _ in 0..25 {
            let code = mint().unwrap();
            assert_eq!(
                validate(&code).unwrap(),
                code,
                "a freshly minted code did not validate: {code}"
            );
        }
    }

    #[test]
    fn minted_codes_are_unique() {
        let a = mint().unwrap();
        let b = mint().unwrap();
        assert_ne!(a, b);
    }

    #[test]
    fn minted_codes_have_the_documented_shape() {
        let code = mint().unwrap();
        let groups: Vec<&str> = code.split('-').collect();
        assert_eq!(groups.len(), 5, "{code}");
        assert_eq!(groups[0], PREFIX);
        for group in &groups[1..] {
            assert_eq!(group.len(), GROUP, "{code}");
            assert!(group.bytes().all(|b| ALPHABET.contains(&b)), "{code}");
        }
    }

    #[test]
    fn minting_uses_the_whole_alphabet() {
        // Guards against a generator that is biased or that never emits part of
        // the alphabet, which would shrink the effective keyspace.
        let mut seen = [false; 32];
        for _ in 0..200 {
            let code = mint().unwrap();
            let body: String = code
                .split('-')
                .skip(1)
                .take(3)
                .collect::<Vec<_>>()
                .concat();
            for b in body.bytes() {
                let idx = ALPHABET.iter().position(|a| *a == b).unwrap();
                seen[idx] = true;
            }
        }
        assert!(
            seen.iter().all(|s| *s),
            "some alphabet characters are never minted"
        );
    }

    /// Prints a batch of codes for issuing to customers.
    ///
    /// Ignored by default so `cargo test` stays quiet and deterministic; run
    /// explicitly when codes are needed:
    ///
    /// ```text
    /// cargo test mint_a_batch -- --nocapture --ignored
    /// ```
    #[test]
    #[ignore = "prints activation codes on demand; run explicitly with --ignored"]
    fn mint_a_batch() {
        for _ in 0..10 {
            println!("{}", mint().unwrap());
        }
    }

    // -- Digests -------------------------------------------------------------

    #[test]
    fn the_digest_is_stable_for_the_same_code_and_device() {
        let code = known_code();
        let device = "a".repeat(64);
        assert_eq!(digest(&code, &device), digest(&code, &device));
    }

    #[test]
    fn the_digest_ignores_formatting_of_the_code() {
        // Otherwise re-entering the same code with different spacing would look
        // like a different activation.
        let device = "a".repeat(64);
        let canonical = digest(&known_code(), &device);
        assert_eq!(digest(&known_code().to_lowercase(), &device), canonical);
    }

    #[test]
    fn the_digest_differs_per_device() {
        // Two machines activated with one code must not store the same value.
        let code = known_code();
        assert_ne!(digest(&code, &"a".repeat(64)), digest(&code, &"b".repeat(64)));
    }

    #[test]
    fn the_digest_does_not_contain_the_code() {
        // The assertion behind "the stored file does not reveal the key".
        let code = known_code();
        let d = digest(&code, &"a".repeat(64));
        assert!(!d.contains("ABCDE"));
        assert_eq!(d.len(), 64);
    }

    #[test]
    fn every_rejection_carries_a_message() {
        for r in [KeyRejection::Malformed, KeyRejection::ChecksumFailed] {
            assert!(!r.message().is_empty());
        }
    }
}
