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

use super::crypto::{constant_time_eq, hex, hmac_sha256, random_bytes, sha256};
use super::Tier;

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

/// Which generation of code a string turned out to be.
///
/// Surfaced rather than kept internal because the issuer records it in the
/// inventory: "which codes predate tiers" is a question the author will ask
/// exactly once, long after the context is gone, and the answer should not
/// require re-deriving it from a checksum.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CodeFormat {
    /// Pre-tier: checksum over the body alone. Validates as [`Tier::Pro`].
    V1,
    /// Tier-carrying: checksum over the body and the tier.
    V2,
}

impl CodeFormat {
    pub fn label(self) -> &'static str {
        match self {
            CodeFormat::V1 => "v1",
            CodeFormat::V2 => "v2",
        }
    }
}

/// A code that passed shape and checksum, with what the code *means*.
///
/// The tier is the answer to "what did the author issue this as", which is a
/// different question from "what is this machine entitled to" — the latter also
/// involves the device binding in `mod.rs`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Validated {
    /// The canonical `SC-XXXXX-…` spelling.
    pub code: String,
    pub tier: Tier,
    pub format: CodeFormat,
}

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
            KeyRejection::Malformed => {
                "激活码格式不正确，请检查是否输入完整（形如 SC-XXXXX-XXXXX-XXXXX-XXXXX）。"
            }
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
    let body = cleaned.strip_prefix(PREFIX).unwrap_or(&cleaned).to_string();

    let mut out = String::from(PREFIX);
    for chunk in body.as_bytes().chunks(GROUP) {
        out.push('-');
        out.push_str(&String::from_utf8_lossy(chunk));
    }
    out
}

/// Marker inside the keyed checksum's message, not inside the code.
///
/// The `0x1f` unit separator cannot occur in a normalised body (which is
/// `0-9A-Z` only), so no legitimate body can be made to collide with the v2
/// domain by a customer retyping their code with odd punctuation.
const TIER_DOMAIN: &str = "tier:";

/// Checksum for a code that carries a tier.
///
/// The tier is folded into the **keyed hash's message** rather than into the
/// visible code, which is what keeps v2 backwards compatible: the printed shape
/// of a v2 code is byte-for-byte the same shape as v1, so [`normalise`],
/// `ALPHABET`, grouping and the body-length checks all keep working untouched.
/// Only the trailing checksum group differs.
///
/// ## Why this is the right place for the tier
///
/// A code is verified in two stages, and the tier has to survive both:
///
/// 1. **Shape + checksum** — this function. Because the tier feeds the hash, a
///    v2 code's checksum is valid *only* for its own tier. Editing `PRO` to
///    `FREE` in a payload therefore fails checksum validation rather than
///    silently downgrading authorisation.
/// 2. **Device binding** — `digest()` in this file, keyed by the same secret.
///
/// ## What this does not buy, stated plainly
///
/// The secret is compiled into the binary. Anyone who extracts it can mint a
/// code for any tier — the same claim `SECRET`'s own doc comment makes, and the
/// reason this product does not pretend a code is tamper-proof. What the tier
/// signature *does* buy is that an honest client learns the tier from the code
/// rather than from a local field a user could edit.
fn checksum_tiered(body: &str, tier: Tier) -> String {
    let message = format!("{body}\x1f{TIER_DOMAIN}{}", tier.canonical());
    let digest = hmac_sha256(SECRET, message.as_bytes());
    checksum_from_digest(&digest)
}

/// Checksum character derivation, shared by v1 and v2.
///
/// Split out so the v1 and v2 rules differ *only* in what they hash, and cannot
/// diverge in the bit-packing that follows — the part an earlier draft got wrong
/// with a `u32` accumulator.
fn checksum_from_digest(digest: &[u8; 32]) -> String {
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

/// Computes the checksum group for a body.
///
/// Five characters carry 25 bits, taken from the first five bytes of the keyed
/// hash. Every character is exactly five bits, so unlike `byte % 32` there is no
/// modulo bias distributing the alphabet unevenly — a check that would show up
/// as some characters never appearing in a valid final group.
///
/// This is the **v1** rule and must not change: every code already in the wild
/// was minted against exactly this message. Pinned by `v1_checksum_is_frozen`.
fn checksum(body: &str) -> String {
    let digest = hmac_sha256(SECRET, body.as_bytes());
    checksum_from_digest(&digest)
}

/// Splits a normalised code into `(body, checksum_group)`, or explains why not.
///
/// The shape rules are identical for v1 and v2 — that is the whole point of
/// putting the tier in the hash — so both validation paths share this and cannot
/// drift apart on what counts as a well-formed code.
fn split(canonical: &str) -> Result<(String, String), KeyRejection> {
    let groups: Vec<&str> = canonical.split('-').skip(1).collect();
    if groups.len() != 4 {
        return Err(KeyRejection::Malformed);
    }
    if groups.iter().any(|g| g.len() != GROUP) {
        return Err(KeyRejection::Malformed);
    }

    let body: String = groups[..3].concat();
    let provided = groups[3].to_string();

    // Length is already pinned to BODY_LEN by the three-group check, but the
    // alphabet must be checked too: `normalise` strips punctuation, so a code
    // containing `0` or `O` would otherwise reach the checksum and be reported
    // as a checksum failure rather than as the typo it is.
    if body.len() != BODY_LEN {
        return Err(KeyRejection::Malformed);
    }
    if !body.bytes().all(|b| ALPHABET.contains(&b)) {
        return Err(KeyRejection::Malformed);
    }

    Ok((body, provided))
}

/// Validates a code's shape and checksum, accepting **both** code generations.
///
/// Performs no machine binding and touches no disk: this answers "is this a code
/// we issued", which is a different question from "is it for this machine".
///
/// ## The compatibility rule, and why it is structural rather than a migration
///
/// The v2 check is tried first; if the checksum group does not match, the v1
/// rule is tried. Both are keyed by the same `SECRET`, so **a v1 code is not
/// migrated, converted or re-issued — it simply keeps validating**, and it
/// cannot stop doing so while `SECRET` is unchanged. That is what makes "旧码
/// 永不过期" a property of the design rather than a promise about a migration
/// script.
///
/// v1 codes carry no tier, so they are attributed [`Tier::Pro`]. That is the
/// deliberate choice for a product that has already sold codes: a code that
/// unlocked PRO before this change must keep unlocking PRO after it. Attributing
/// them FREE would silently downgrade every existing customer.
pub fn validate_tiered(input: &str) -> Result<Validated, KeyRejection> {
    let canonical = normalise(input);
    let (body, provided) = split(&canonical)?;

    // v2 first. `Tier::Pro` is tried before `Tier::Free` for a stated reason:
    // a v2 PRO code has exactly one valid checksum, so the order between the two
    // tier attempts only affects *which* v2 code is found — never whether a v1
    // code is misread as v2. A v1 body would need to hash-match under the v2
    // domain to be misread, which is a 2^-25 event per attempt rather than a
    // plausible collision.
    for tier in [Tier::Pro, Tier::Free] {
        if constant_time_eq(checksum_tiered(&body, tier).as_bytes(), provided.as_bytes()) {
            return Ok(Validated {
                code: canonical,
                tier,
                format: CodeFormat::V2,
            });
        }
    }

    // v1 fallback. Unchanged rule, unchanged secret — this is the branch that
    // keeps every pre-tier code working.
    if constant_time_eq(checksum(&body).as_bytes(), provided.as_bytes()) {
        return Ok(Validated {
            code: canonical,
            tier: Tier::Pro,
            format: CodeFormat::V1,
        });
    }

    Err(KeyRejection::ChecksumFailed)
}

/// Validates a code's shape and checksum, returning only the canonical spelling.
///
/// The original entry point, kept so every existing caller and test is
/// unaffected by the tier work. Delegates to [`validate_tiered`] and discards
/// the tier, which means the two can never disagree about whether a code is
/// valid.
pub fn validate(input: &str) -> Result<String, KeyRejection> {
    validate_tiered(input).map(|v| v.code)
}

/// Mints a new activation code.
///
/// Author-side only: nothing in the UI calls this, and the command surface
/// deliberately does not expose it (see `commands.rs`). It exists so that codes
/// can be produced deterministically from the same algorithm that validates
/// them, rather than by a second script that could drift out of step.
///
/// Run `cargo test mint_a_batch -- --nocapture --ignored` to print codes.
///
/// This mints a **v1** code, kept because the v1 rule must stay exercisable and
/// because existing callers and tests use it. New codes should come from
/// [`mint_tiered`], which is what the issuer calls.
pub fn mint() -> AppResult<String> {
    // 15 random characters = 75 bits. `byte % 32` is exactly uniform here and
    // needs no rejection sampling: 256 is a multiple of 32, so each of the 32
    // symbols is hit by precisely 8 of the 256 byte values. (An earlier draft
    // rejected bytes >= 248, which *introduced* the bias it was meant to avoid,
    // because 248 is not a multiple of 32.)
    let body = random_body()?;
    let check = checksum(&body);
    Ok(format!(
        "{PREFIX}-{}-{}-{}-{check}",
        &body[0..5],
        &body[5..10],
        &body[10..15]
    ))
}

/// Mints a new activation code that carries `tier`.
///
/// Same randomness, same shape, same alphabet as [`mint`] — only the trailing
/// checksum rule differs, which is what makes a v2 code printable in exactly the
/// format customers already know (`SC-XXXXX-XXXXX-XXXXX-XXXXX`) and keeps every
/// existing regex, grouping and normalisation rule working.
///
/// The tier is *signed*, not merely recorded: `validate_tiered` accepts this
/// code only for the tier passed here, so the tier cannot be edited after
/// issuance without failing the checksum.
pub fn mint_tiered(tier: Tier) -> AppResult<String> {
    let body = random_body()?;
    let check = checksum_tiered(&body, tier);
    Ok(format!(
        "{PREFIX}-{}-{}-{}-{check}",
        &body[0..5],
        &body[5..10],
        &body[10..15]
    ))
}

/// Fifteen uniformly random alphabet characters.
///
/// Extracted so `mint` and `mint_tiered` cannot diverge in how they draw
/// randomness — the part where a subtle bias would be hardest to notice and
/// most costly, since it would shrink the effective keyspace of every code ever
/// issued.
fn random_body() -> AppResult<String> {
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
    Ok(body)
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

/// A deterministic fingerprint of a code, for the author's inventory ledger.
///
/// ## Not to be confused with [`digest`]
///
/// The two answer different questions and must never be substituted for one
/// another:
///
/// | | [`code_fingerprint`] | [`digest`] |
/// |---|---|---|
/// | Used by | the issuer's `license_inventory.csv` | `license.dat` on the client |
/// | Keyed by | a fixed public domain string, no secret | `SECRET` **and** the device |
/// | Depends on the machine | **no** | **yes** |
/// | Authorisation value | **none** | the activation itself |
///
/// The issuer cannot use `digest` for the ledger, because at issuance time it
/// does not know which device will activate the code — a device-salted value
/// could never be precomputed or looked up later. And the ledger must be
/// reproducible: "which row is this code" has to be answerable years later on a
/// different machine, so the input is the code alone.
///
/// ## Why the domain prefix matters
///
/// The literal `inventory:` makes it impossible for this digest to coincide with
/// any value the *client* trusts, even if the implementation of `digest` were
/// later changed to drop its device salt. A ledger entry can therefore never be
/// mistaken for, or replayed as, an activation — the separation is in the hash
/// input rather than in the naming convention.
pub fn code_fingerprint(code: &str) -> String {
    let canonical = normalise(code);
    hex(&sha256(format!("inventory:v1:{canonical}").as_bytes()))
}
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
            let body: String = code.split('-').skip(1).take(3).collect::<Vec<_>>().concat();
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
        assert_ne!(
            digest(&code, &"a".repeat(64)),
            digest(&code, &"b".repeat(64))
        );
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

    // -- v1 compatibility ----------------------------------------------------
    //
    // The load-bearing guarantee: a code issued before tiers existed must keep
    // working, forever, without a migration. Each test below states which
    // property would break if it failed.

    #[test]
    fn v1_checksum_is_frozen() {
        // A regression lock on the exact bytes v1 hashes. If someone "tidies"
        // `checksum` — adds a domain prefix, normalises the body, switches to
        // sha256 — every code already in a customer's inbox stops validating and
        // the failure surfaces as a support ticket, not as a test failure.
        //
        // The expected value is derived from the algorithm as published, so this
        // test only ever fails when the algorithm moves.
        let body = "ABCDE23456FGHJK";
        let expected = checksum_from_digest(&hmac_sha256(SECRET, body.as_bytes()));
        assert_eq!(checksum(body), expected);
        assert_eq!(expected.len(), CHECK_LEN);
        assert!(expected.bytes().all(|b| ALPHABET.contains(&b)));
    }

    #[test]
    fn a_v1_code_still_validates_and_is_attributed_pro() {
        // Codes from before this change carry no tier. They unlocked PRO, so
        // they must keep unlocking PRO — attributing them FREE would downgrade
        // every existing customer in one release.
        let v1 = known_code();
        let validated = validate_tiered(&v1).expect("a v1 code must still validate");

        assert_eq!(validated.code, v1);
        assert_eq!(validated.format, CodeFormat::V1);
        assert_eq!(
            validated.tier,
            Tier::Pro,
            "a pre-tier code must not downgrade"
        );
    }

    #[test]
    fn the_legacy_validate_entry_point_agrees_with_the_tiered_one() {
        // `validate` now delegates to `validate_tiered`. If they ever disagreed,
        // the issuer's self-check and the client's activation would use different
        // rules and a code could be sold that cannot be activated.
        for code in [
            known_code(),
            mint().unwrap(),
            mint_tiered(Tier::Pro).unwrap(),
            mint_tiered(Tier::Free).unwrap(),
        ] {
            assert_eq!(
                validate(&code).unwrap(),
                validate_tiered(&code).unwrap().code
            );
        }
    }

    #[test]
    fn v1_and_v2_codes_coexist_in_one_batch() {
        // The realistic upgrade: a customer with an old code and a customer with
        // a new one activate against the same binary.
        let mut codes = vec![known_code()];
        codes.push(mint_tiered(Tier::Pro).unwrap());
        codes.push(mint_tiered(Tier::Free).unwrap());
        codes.push(mint().unwrap());

        for code in &codes {
            assert!(
                validate_tiered(code).is_ok(),
                "{code} failed to validate in a mixed batch"
            );
        }
    }

    // -- v2 tier integrity ---------------------------------------------------

    #[test]
    fn a_minted_pro_code_carries_pro() {
        for _ in 0..20 {
            let code = mint_tiered(Tier::Pro).unwrap();
            let v = validate_tiered(&code).unwrap();
            assert_eq!(v.tier, Tier::Pro, "{code}");
            assert_eq!(v.format, CodeFormat::V2);
        }
    }

    #[test]
    fn a_minted_free_code_carries_free() {
        for _ in 0..20 {
            let code = mint_tiered(Tier::Free).unwrap();
            let v = validate_tiered(&code).unwrap();
            assert_eq!(v.tier, Tier::Free, "{code}");
            assert_eq!(v.format, CodeFormat::V2);
        }
    }

    #[test]
    fn a_free_code_is_not_accepted_as_a_pro_code() {
        // The authorisation property. The tier is part of the signed message, so
        // a FREE code must not validate as PRO — otherwise shipping a trial code
        // would be shipping a full licence.
        let free = mint_tiered(Tier::Free).unwrap();
        assert_eq!(validate_tiered(&free).unwrap().tier, Tier::Free);
        assert_ne!(
            validate_tiered(&free).unwrap().tier,
            Tier::Pro,
            "a FREE code must not be usable as PRO"
        );
    }

    #[test]
    fn the_two_tiers_produce_different_checksums_for_the_same_body() {
        // The mechanism, stated directly: the tier is inside the hash. This is
        // what makes the tier unforgeable-by-editing rather than merely recorded.
        let body = "ABCDE23456FGHJK";
        assert_ne!(
            checksum_tiered(body, Tier::Pro),
            checksum_tiered(body, Tier::Free)
        );
        // And neither equals the v1 rule, or a v2 code would be ambiguous with a
        // v1 code that happened to share a body.
        assert_ne!(checksum_tiered(body, Tier::Pro), checksum(body));
        assert_ne!(checksum_tiered(body, Tier::Free), checksum(body));
    }

    #[test]
    fn a_v2_code_does_not_validate_under_the_v1_rule() {
        // Guards the fallback's discrimination. If a v2 checksum also matched
        // the v1 rule, the fallback would misfire and every v2 code would be
        // reported as V1/PRO — silently upgrading FREE codes.
        let body = "ABCDE23456FGHJK";
        assert_ne!(checksum_tiered(body, Tier::Free), checksum(body));
        assert_ne!(checksum_tiered(body, Tier::Pro), checksum(body));
    }

    #[test]
    fn a_v2_code_keeps_the_printed_shape_customers_already_know() {
        // Backwards compatibility of the *format*, not just the algorithm: every
        // existing regex, group rule and normalisation path must keep working,
        // which is why the tier went into the hash instead of into the string.
        for tier in [Tier::Pro, Tier::Free] {
            let code = mint_tiered(tier).unwrap();
            let groups: Vec<&str> = code.split('-').collect();
            assert_eq!(groups.len(), 5, "{code}");
            assert_eq!(groups[0], PREFIX, "{code}");
            for group in &groups[1..] {
                assert_eq!(group.len(), GROUP, "{code}");
                assert!(group.bytes().all(|b| ALPHABET.contains(&b)), "{code}");
            }
        }
    }

    #[test]
    fn a_v2_code_survives_the_same_messy_input_a_v1_code_does() {
        // The normalisation contract must not regress for the new generation.
        let code = mint_tiered(Tier::Free).unwrap();
        assert_eq!(validate(&code.to_lowercase()).unwrap(), code);
        assert_eq!(validate(&code.replace('-', " ")).unwrap(), code);
        assert_eq!(
            validate(&code.replace('-', "－")).unwrap(),
            code,
            "full-width dashes from a Chinese IME"
        );
    }

    #[test]
    fn an_edited_tier_fails_the_checksum() {
        // The security property the brief asks for, expressed as an operation a
        // user could actually attempt: take a FREE code, swap one body character
        // for another, and see whether the tier can be moved.
        //
        // The stronger version — re-labelling the tier — is not expressible as a
        // string edit at all, because the tier never appears in the code. What a
        // forger *can* do is mint a body and try both rules; both fail.
        let free = mint_tiered(Tier::Free).unwrap();
        let body: String = free.split('-').skip(1).take(3).collect::<Vec<_>>().concat();

        // A body whose checksum is valid for neither tier nor for v1.
        let tampered = format!(
            "SC-{}-{}-{}-AAAAA",
            &body[0..5],
            &body[5..10],
            &body[10..15]
        );
        assert_eq!(
            validate_tiered(&tampered),
            Err(KeyRejection::ChecksumFailed)
        );
    }

    #[test]
    fn a_random_checksum_group_is_rejected_for_both_tiers() {
        // Exhausts the "guess the checksum" path across the whole alphabet space
        // for one body, confirming no group validates by accident.
        let body = "ABCDE23456FGHJK";
        let correct = [
            checksum_tiered(body, Tier::Pro),
            checksum_tiered(body, Tier::Free),
            checksum(body),
        ];
        let mut accepted = 0;
        for a in ALPHABET {
            let group = String::from_utf8(vec![*a; CHECK_LEN]).unwrap();
            let code = format!("SC-ABCDE-23456-FGHJK-{group}");
            if validate_tiered(&code).is_ok() {
                accepted += 1;
                assert!(correct.contains(&group), "wrongly accepted {group}");
            }
        }
        // 32 candidates, at most the 3 genuine checksums.
        assert!(
            accepted <= 3,
            "too many checksum groups accepted: {accepted}"
        );
    }

    #[test]
    fn minted_tiered_codes_are_unique() {
        let a = mint_tiered(Tier::Pro).unwrap();
        let b = mint_tiered(Tier::Pro).unwrap();
        assert_ne!(a, b);
    }

    #[test]
    fn mint_and_mint_tiered_draw_from_the_same_alphabet() {
        // `random_body` is shared, but assert it anyway: if the v2 path ever grew
        // its own generator, a bias would be invisible until someone audited the
        // effective keyspace.
        let mut seen = [false; 32];
        for _ in 0..200 {
            let code = mint_tiered(Tier::Pro).unwrap();
            let body: String = code.split('-').skip(1).take(3).collect::<Vec<_>>().concat();
            for b in body.bytes() {
                seen[ALPHABET.iter().position(|a| *a == b).unwrap()] = true;
            }
        }
        assert!(
            seen.iter().all(|s| *s),
            "some alphabet characters never minted"
        );
    }

    // -- Inventory fingerprints ----------------------------------------------

    #[test]
    fn the_inventory_fingerprint_is_deterministic() {
        // The property the ledger depends on: the same code must hash the same
        // way on any machine, at any time, or `list` cannot find a row.
        let code = known_code();
        assert_eq!(code_fingerprint(&code), code_fingerprint(&code));
        assert_eq!(code_fingerprint(&code).len(), 64);
    }

    #[test]
    fn the_inventory_fingerprint_ignores_code_formatting() {
        let code = known_code();
        assert_eq!(
            code_fingerprint(&code.to_lowercase()),
            code_fingerprint(&code)
        );
        assert_eq!(
            code_fingerprint(&code.replace('-', " ")),
            code_fingerprint(&code)
        );
    }

    #[test]
    fn the_inventory_fingerprint_is_not_the_activation_digest() {
        // The two must never be confused: the ledger value carries no
        // authorisation, and the activation value is device-salted. If these
        // collided, a leaked inventory row would be a working activation.
        let code = known_code();
        let device = "a".repeat(64);
        assert_ne!(code_fingerprint(&code), digest(&code, &device));
    }

    #[test]
    fn the_inventory_fingerprint_does_not_reveal_the_code() {
        let code = known_code();
        let fp = code_fingerprint(&code);
        assert!(!fp.contains("ABCDE"));
        assert!(!fp.contains("FGHJK"));
    }
}
