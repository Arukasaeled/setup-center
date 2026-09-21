//! Primitives for the licensing module: hashing, keyed signing, and the
//! OS-provided encryption that protects the activation file at rest.
//!
//! ## Why these are hand-written rather than pulled from crates
//!
//! The product constraint is that Setup Center keeps working offline, on a
//! machine that may have no network at all, with a toolchain that must not need
//! to fetch anything new. Adding `sha2` + `hmac` + `aes` would mean three more
//! dependencies in a build whose entire supply chain is currently `tauri`,
//! `serde`, `serde_json` and `thiserror`. SHA-256 and HMAC are small, frozen,
//! test-vector-verified algorithms; the tests below pin them against the
//! published vectors so "we wrote it ourselves" cannot mean "we wrote it wrong".
//!
//! ## What is *not* hand-written
//!
//! The encryption is not ours. [`protect`] and [`unprotect`] call Windows DPAPI
//! (`CryptProtectData` / `CryptUnprotectData`), which derives its key from the
//! OS's per-user secrets and never exposes it to this process. Rolling our own
//! cipher, or shipping a machine-derived AES key, would put a key that can be
//! extracted from the binary in charge of a file whose whole purpose is to be
//! unreadable. DPAPI is the stronger primitive and it costs one FFI call.

use crate::model::{AppError, AppResult};

// ---------------------------------------------------------------------------
// SHA-256
// ---------------------------------------------------------------------------

const K: [u32; 64] = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
];

const H0: [u32; 8] = [
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
];

/// SHA-256, per FIPS 180-4.
pub fn sha256(data: &[u8]) -> [u8; 32] {
    let mut h = H0;

    let bit_len = (data.len() as u64).wrapping_mul(8);
    let mut msg = Vec::with_capacity(data.len() + 72);
    msg.extend_from_slice(data);
    msg.push(0x80);
    while msg.len() % 64 != 56 {
        msg.push(0);
    }
    msg.extend_from_slice(&bit_len.to_be_bytes());

    let mut w = [0u32; 64];
    for chunk in msg.chunks_exact(64) {
        for i in 0..16 {
            w[i] = u32::from_be_bytes([
                chunk[i * 4],
                chunk[i * 4 + 1],
                chunk[i * 4 + 2],
                chunk[i * 4 + 3],
            ]);
        }
        for i in 16..64 {
            let s0 = w[i - 15].rotate_right(7) ^ w[i - 15].rotate_right(18) ^ (w[i - 15] >> 3);
            let s1 = w[i - 2].rotate_right(17) ^ w[i - 2].rotate_right(19) ^ (w[i - 2] >> 10);
            w[i] = w[i - 16]
                .wrapping_add(s0)
                .wrapping_add(w[i - 7])
                .wrapping_add(s1);
        }

        let (mut a, mut b, mut c, mut d) = (h[0], h[1], h[2], h[3]);
        let (mut e, mut f, mut g, mut hh) = (h[4], h[5], h[6], h[7]);

        for i in 0..64 {
            let s1 = e.rotate_right(6) ^ e.rotate_right(11) ^ e.rotate_right(25);
            let ch = (e & f) ^ ((!e) & g);
            let t1 = hh
                .wrapping_add(s1)
                .wrapping_add(ch)
                .wrapping_add(K[i])
                .wrapping_add(w[i]);
            let s0 = a.rotate_right(2) ^ a.rotate_right(13) ^ a.rotate_right(22);
            let maj = (a & b) ^ (a & c) ^ (b & c);
            let t2 = s0.wrapping_add(maj);

            hh = g;
            g = f;
            f = e;
            e = d.wrapping_add(t1);
            d = c;
            c = b;
            b = a;
            a = t1.wrapping_add(t2);
        }

        h[0] = h[0].wrapping_add(a);
        h[1] = h[1].wrapping_add(b);
        h[2] = h[2].wrapping_add(c);
        h[3] = h[3].wrapping_add(d);
        h[4] = h[4].wrapping_add(e);
        h[5] = h[5].wrapping_add(f);
        h[6] = h[6].wrapping_add(g);
        h[7] = h[7].wrapping_add(hh);
    }

    let mut out = [0u8; 32];
    for (i, word) in h.iter().enumerate() {
        out[i * 4..i * 4 + 4].copy_from_slice(&word.to_be_bytes());
    }
    out
}

/// HMAC-SHA256, per RFC 2104.
pub fn hmac_sha256(key: &[u8], message: &[u8]) -> [u8; 32] {
    const BLOCK: usize = 64;

    let mut normalised = [0u8; BLOCK];
    if key.len() > BLOCK {
        normalised[..32].copy_from_slice(&sha256(key));
    } else {
        normalised[..key.len()].copy_from_slice(key);
    }

    let mut inner_pad = [0x36u8; BLOCK];
    let mut outer_pad = [0x5cu8; BLOCK];
    for i in 0..BLOCK {
        inner_pad[i] ^= normalised[i];
        outer_pad[i] ^= normalised[i];
    }

    let mut inner = Vec::with_capacity(BLOCK + message.len());
    inner.extend_from_slice(&inner_pad);
    inner.extend_from_slice(message);

    let mut outer = Vec::with_capacity(BLOCK + 32);
    outer.extend_from_slice(&outer_pad);
    outer.extend_from_slice(&sha256(&inner));

    sha256(&outer)
}

/// Lowercase hex, the spelling used for hashes that go into the licence file.
pub fn hex(bytes: &[u8]) -> String {
    const DIGITS: &[u8; 16] = b"0123456789abcdef";
    let mut out = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        out.push(DIGITS[(byte >> 4) as usize] as char);
        out.push(DIGITS[(byte & 0x0f) as usize] as char);
    }
    out
}

/// Compares two byte strings without leaking where they first differ.
///
/// Used for the activation-code checksum. A short-circuiting `==` on a value a
/// user is invited to guess leaks its prefix through timing, which is a real
/// (if modest) oracle for anyone willing to time the call.
pub fn constant_time_eq(a: &[u8], b: &[u8]) -> bool {
    if a.len() != b.len() {
        return false;
    }
    let mut diff = 0u8;
    for i in 0..a.len() {
        diff |= a[i] ^ b[i];
    }
    diff == 0
}

// ---------------------------------------------------------------------------
// Randomness
// ---------------------------------------------------------------------------

/// Fills `len` bytes from the OS CSPRNG.
///
/// Not `rand::thread_rng()`: a licence body generated from a seedable,
/// process-local PRNG is guessable if an attacker can reconstruct the seed, and
/// the whole point of the body is that it cannot be guessed.
pub fn random_bytes(len: usize) -> AppResult<Vec<u8>> {
    let mut buf = vec![0u8; len];
    fill_random(&mut buf)?;
    Ok(buf)
}

#[cfg(windows)]
fn fill_random(buf: &mut [u8]) -> AppResult<()> {
    use windows_sys::Win32::Security::Cryptography::{
        BCryptGenRandom, BCRYPT_USE_SYSTEM_PREFERRED_RNG,
    };

    let status = unsafe {
        BCryptGenRandom(
            std::ptr::null_mut(),
            buf.as_mut_ptr(),
            buf.len() as u32,
            BCRYPT_USE_SYSTEM_PREFERRED_RNG,
        )
    };
    if status != 0 {
        return Err(AppError::Internal(format!(
            "无法获取系统随机数（NTSTATUS {status}）。"
        )));
    }
    Ok(())
}

#[cfg(not(windows))]
fn fill_random(_buf: &mut [u8]) -> AppResult<()> {
    Err(AppError::Internal(
        "授权模块仅支持 Windows。".to_string(),
    ))
}

// ---------------------------------------------------------------------------
// At-rest encryption (DPAPI)
// ---------------------------------------------------------------------------

/// Encrypts `plaintext` so that only this Windows user on this machine can
/// decrypt it.
///
/// The returned blob is what lands in `license.dat`. DPAPI ties the ciphertext
/// to the logged-in user's credentials, so copying the file to another machine
/// or another account does not carry an activation with it — which is the
/// property the brief asks for, obtained without us owning a key.
#[cfg(windows)]
pub fn protect(plaintext: &[u8]) -> AppResult<Vec<u8>> {
    use windows_sys::Win32::Foundation::LocalFree;
    use windows_sys::Win32::Security::Cryptography::{
        CryptProtectData, CRYPT_INTEGER_BLOB, CRYPTPROTECT_UI_FORBIDDEN,
    };

    let mut input = CRYPT_INTEGER_BLOB {
        cbData: plaintext.len() as u32,
        pbData: plaintext.as_ptr() as *mut u8,
    };
    let mut output = CRYPT_INTEGER_BLOB {
        cbData: 0,
        pbData: std::ptr::null_mut(),
    };

    // `CRYPTPROTECT_UI_FORBIDDEN` because this runs before the window exists
    // and inside a command handler: a DPAPI prompt would block the UI thread
    // with a dialog the student cannot explain. Failing instead of prompting is
    // the correct trade for a background write.
    let ok = unsafe {
        CryptProtectData(
            &mut input,
            std::ptr::null(),
            std::ptr::null(),
            std::ptr::null(),
            std::ptr::null(),
            CRYPTPROTECT_UI_FORBIDDEN,
            &mut output,
        )
    };
    if ok == 0 {
        return Err(AppError::Internal(
            "无法加密授权文件（DPAPI 拒绝写入）。".to_string(),
        ));
    }

    let blob =
        unsafe { std::slice::from_raw_parts(output.pbData, output.cbData as usize).to_vec() };
    unsafe {
        LocalFree(output.pbData as *mut _);
    }
    Ok(blob)
}

/// Reverses [`protect`].
///
/// Fails when the blob was written by another user or machine — which is the
/// detection the brief wants, surfacing as "no valid activation" rather than as
/// a crash.
#[cfg(windows)]
pub fn unprotect(blob: &[u8]) -> AppResult<Vec<u8>> {
    use windows_sys::Win32::Foundation::LocalFree;
    use windows_sys::Win32::Security::Cryptography::{
        CryptUnprotectData, CRYPT_INTEGER_BLOB, CRYPTPROTECT_UI_FORBIDDEN,
    };

    let mut input = CRYPT_INTEGER_BLOB {
        cbData: blob.len() as u32,
        pbData: blob.as_ptr() as *mut u8,
    };
    let mut output = CRYPT_INTEGER_BLOB {
        cbData: 0,
        pbData: std::ptr::null_mut(),
    };

    let ok = unsafe {
        CryptUnprotectData(
            &mut input,
            std::ptr::null_mut(),
            std::ptr::null(),
            std::ptr::null(),
            std::ptr::null(),
            CRYPTPROTECT_UI_FORBIDDEN,
            &mut output,
        )
    };
    if ok == 0 {
        return Err(AppError::Internal(
            "授权文件无法解密：它不属于当前 Windows 账户或当前设备。".to_string(),
        ));
    }

    let plain =
        unsafe { std::slice::from_raw_parts(output.pbData, output.cbData as usize).to_vec() };
    unsafe {
        LocalFree(output.pbData as *mut _);
    }
    Ok(plain)
}

#[cfg(not(windows))]
pub fn protect(_plaintext: &[u8]) -> AppResult<Vec<u8>> {
    Err(AppError::Internal("授权模块仅支持 Windows。".to_string()))
}

#[cfg(not(windows))]
pub fn unprotect(_blob: &[u8]) -> AppResult<Vec<u8>> {
    Err(AppError::Internal("授权模块仅支持 Windows。".to_string()))
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    /// Renders a digest as hex, for comparing against published vectors.
    fn digest_hex(input: &[u8]) -> String {
        hex(&sha256(input))
    }

    // -- SHA-256 -------------------------------------------------------------
    //
    // Pinned against FIPS 180-4 / the NIST examples. These are the assertions
    // that make "we wrote our own SHA-256" acceptable: if the compression
    // function is wrong in any way, at least one of these changes.

    #[test]
    fn sha256_matches_the_empty_string_vector() {
        assert_eq!(
            digest_hex(b""),
            "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
        );
    }

    #[test]
    fn sha256_matches_the_abc_vector() {
        assert_eq!(
            digest_hex(b"abc"),
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
    }

    #[test]
    fn sha256_matches_the_448_bit_vector() {
        // Covers the padding branch where the length spills into an extra
        // block — the case a naive implementation gets wrong.
        assert_eq!(
            digest_hex(b"abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq"),
            "248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1"
        );
    }

    #[test]
    fn sha256_handles_a_message_longer_than_one_block() {
        assert_eq!(
            digest_hex(&vec![b'a'; 1_000_000]),
            "cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0"
        );
    }

    #[test]
    fn sha256_of_different_inputs_never_collides_in_practice() {
        // A cheap sanity check that the function actually depends on its input
        // rather than, say, returning a constant that happens to match one
        // vector.
        let a = sha256(b"setup-center");
        let b = sha256(b"setup-centre");
        assert_ne!(a, b);
    }

    // -- HMAC ----------------------------------------------------------------

    #[test]
    fn hmac_matches_rfc4231_case_1() {
        let key = [0x0bu8; 20];
        assert_eq!(
            hex(&hmac_sha256(&key, b"Hi There")),
            "b0344c61d8db38535ca8afceaf0bf12b881dc200c9833da726e9376c2e32cff7"
        );
    }

    #[test]
    fn hmac_matches_rfc4231_case_2() {
        let got = hex(&hmac_sha256(b"Jefe", b"what do ya want for nothing?"));
        assert_eq!(
            got,
            "5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843"
        );
    }

    #[test]
    fn hmac_matches_rfc4231_case_6_key_longer_than_block() {
        // The `key.len() > BLOCK` branch: a key that must itself be hashed
        // first. Exercised because the branch is invisible in every normal use.
        let key = [0xaau8; 131];
        let got = hex(&hmac_sha256(
            &key,
            b"Test Using Larger Than Block-Size Key - Hash Key First",
        ));
        assert_eq!(
            got,
            "60e431591ee0b67f0d8a26aacbf5b77f8e0bc6213728c5140546040f0ee37f54"
        );
    }

    #[test]
    fn hmac_depends_on_the_key_not_only_the_message() {
        let a = hmac_sha256(b"key-one", b"message");
        let b = hmac_sha256(b"key-two", b"message");
        assert_ne!(a, b);
    }

    // -- Constant-time comparison -------------------------------------------

    #[test]
    fn constant_time_eq_accepts_equal_slices() {
        assert!(constant_time_eq(b"abc123", b"abc123"));
        assert!(constant_time_eq(b"", b""));
    }

    #[test]
    fn constant_time_eq_rejects_any_difference() {
        assert!(!constant_time_eq(b"abc123", b"abc124"));
        assert!(!constant_time_eq(b"abc", b"abcd"));
        assert!(!constant_time_eq(b"", b"a"));
    }

    // -- Randomness ----------------------------------------------------------

    #[test]
    fn random_bytes_returns_the_requested_length() {
        assert_eq!(random_bytes(16).unwrap().len(), 16);
        assert_eq!(random_bytes(0).unwrap().len(), 0);
    }

    #[test]
    fn random_bytes_does_not_repeat() {
        // Guards against a "random" source that is actually a counter or a
        // constant, which would make every minted activation code identical.
        let a = random_bytes(16).unwrap();
        let b = random_bytes(16).unwrap();
        assert_ne!(a, b);
    }

    // -- DPAPI ---------------------------------------------------------------

    #[test]
    fn dpapi_round_trips() {
        let plain = b"{\"version\":1}".to_vec();
        let blob = protect(&plain).unwrap();
        assert_ne!(blob, plain, "the ciphertext must not be the plaintext");
        assert_eq!(unprotect(&blob).unwrap(), plain);
    }

    #[test]
    fn dpapi_output_does_not_contain_the_plaintext() {
        // The assertion behind "激活码不能明文存储": a searchable string must
        // not be findable in the bytes written to disk.
        let plain = b"SC-AAAAA-BBBBB-CCCCC-DDDDD";
        let blob = protect(plain).unwrap();
        assert!(
            !blob.windows(plain.len()).any(|w| w == plain),
            "the activation code appears verbatim in the encrypted blob"
        );
    }

    #[test]
    fn dpapi_rejects_a_corrupted_blob() {
        let mut blob = protect(b"payload").unwrap();
        let len = blob.len();
        blob[len / 2] ^= 0xff;
        assert!(unprotect(&blob).is_err());
    }

    #[test]
    fn dpapi_rejects_arbitrary_bytes() {
        assert!(unprotect(b"this is not a DPAPI blob at all").is_err());
    }
}
