//! Trusted Issuer Public Key Ring for V2 License Verification (Issue A04, A05).
//!
//! ## Security Boundary and Blocking Notice
//!
//! Under the V2 licensing architecture, the software author holds the private
//! signing key offline. The client application only embeds or configures the
//! corresponding public key(s).
//!
//! Production public keys must be provisioned by the project maintainer.
//! Currently, production keys are explicitly blocked on external input:
//! **Status: `BLOCKED_INPUT` (Awaiting production Ed25519 public key pair)**.
//!
//! This module provides the authoritative `PublicKeyRing` contract, supporting:
//! - Multiple key versions (key rotation via `kid`)
//! - Cryptographic algorithm tagging (e.g., `Ed25519`)
//! - Key lifecycle states (`Active`, `Suspended`, `Revoked`, `Unconfigured`)
//! - Staging / test key sets for automated testing without exposing production secrets.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::{OnceLock, RwLock};

/// The asymmetric cryptographic algorithm used for license signing.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum SignatureAlgorithm {
    /// Ed25519 (Edwards-curve Digital Signature Algorithm, RFC 8032)
    Ed25519,
    /// ECDSA with P-256 and SHA-256 (NIST P-256)
    EcdsaP256,
}

impl SignatureAlgorithm {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Ed25519 => "Ed25519",
            Self::EcdsaP256 => "ES256",
        }
    }
}

/// Operational status of an issuer public key.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum KeyStatus {
    /// The key is active and trusted for verifying licenses.
    Active,
    /// The key is provisioned but temporarily suspended from issuing new licenses.
    Suspended,
    /// The key was revoked; any license signed by this key must be rejected.
    Revoked,
    /// Placeholder indicating production key is awaiting external provisioning.
    Unconfigured,
}

/// A trusted public key record held by the client application.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct TrustedIssuerKey {
    /// Key Identifier (e.g., "arukas-2026-root", "setup-center-v2-prod")
    pub kid: String,
    /// Cryptographic algorithm
    pub algorithm: SignatureAlgorithm,
    /// Public key bytes (e.g., 32 bytes for Ed25519) encoded as lowercase hex or Base64
    pub public_key_raw: Vec<u8>,
    /// Operational status
    pub status: KeyStatus,
    /// Optional human-readable description
    pub description: String,
    /// Unix timestamp (seconds) when this key becomes valid
    pub valid_from: u64,
    /// Optional Unix timestamp (seconds) when this key expires
    pub valid_until: Option<u64>,
}

impl TrustedIssuerKey {
    /// Returns true if this key can currently be used to verify signatures.
    pub fn is_usable_at(&self, timestamp: u64) -> bool {
        if self.status != KeyStatus::Active {
            return false;
        }
        if timestamp < self.valid_from {
            return false;
        }
        if let Some(until) = self.valid_until {
            if timestamp > until {
                return false;
            }
        }
        !self.public_key_raw.is_empty()
    }
}

/// In-memory keyring containing trusted issuer public keys.
#[derive(Debug, Default)]
pub struct PublicKeyRing {
    keys: HashMap<String, TrustedIssuerKey>,
}

impl PublicKeyRing {
    pub fn new() -> Self {
        Self {
            keys: HashMap::new(),
        }
    }

    /// Inserts or updates a trusted issuer key.
    pub fn register(&mut self, key: TrustedIssuerKey) {
        self.keys.insert(key.kid.clone(), key);
    }

    /// Looks up a trusted key by its Key Identifier.
    pub fn get(&self, kid: &str) -> Option<&TrustedIssuerKey> {
        self.keys.get(kid)
    }

    /// Returns all registered keys.
    pub fn all(&self) -> Vec<&TrustedIssuerKey> {
        self.keys.values().collect()
    }

    /// Checks if the production key is provisioned or pending external input.
    pub fn is_production_provisioned(&self) -> bool {
        self.keys.values().any(|k| {
            k.status == KeyStatus::Active
                && !k.public_key_raw.is_empty()
                && k.kid.starts_with("prod-")
        })
    }
}

/// Global shared key ring.
static KEY_RING: OnceLock<RwLock<PublicKeyRing>> = OnceLock::new();

fn global_key_ring() -> &'static RwLock<PublicKeyRing> {
    KEY_RING.get_or_init(|| {
        let mut ring = PublicKeyRing::new();

        // 1. Explicit production placeholder (BLOCKED_INPUT):
        // Production public key requires external issuance by the repository owner.
        ring.register(TrustedIssuerKey {
            kid: "prod-2026-v2".to_string(),
            algorithm: SignatureAlgorithm::Ed25519,
            public_key_raw: Vec::new(), // Intentionally empty: awaiting external input
            status: KeyStatus::Unconfigured,
            description: "Production Setup Center V2 Issuer Root Key (Pending external configuration)".to_string(),
            valid_from: 1775000000, // 2026-04-01+
            valid_until: None,
        });

        // 2. Staging / Test key for development and verification harnesses:
        // Well-known dummy 32-byte Ed25519 public key (RFC 8032 test vector pubkey)
        ring.register(TrustedIssuerKey {
            kid: "test-staging-2026".to_string(),
            algorithm: SignatureAlgorithm::Ed25519,
            public_key_raw: vec![
                0xd7, 0x5a, 0x98, 0x01, 0x82, 0xb1, 0x0a, 0xb7, 0xd5, 0x4b, 0xfe, 0xd3, 0xc9,
                0x64, 0x07, 0x3a, 0x0e, 0xe1, 0x72, 0xf3, 0xda, 0xa6, 0x23, 0x25, 0xaf, 0x02,
                0x1a, 0x68, 0xf7, 0x07, 0x51, 0x1a,
            ],
            status: KeyStatus::Active,
            description: "Staging Test Key for CI / Sandbox Static Verification".to_string(),
            valid_from: 0,
            valid_until: None,
        });

        RwLock::new(ring)
    })
}

/// Retrieves a trusted issuer key by Key Identifier from the global ring.
pub fn lookup_key(kid: &str) -> Option<TrustedIssuerKey> {
    global_key_ring().read().ok()?.get(kid).cloned()
}

/// Registers an external key into the global ring (e.g. during test setup).
pub fn register_key(key: TrustedIssuerKey) {
    if let Ok(mut ring) = global_key_ring().write() {
        ring.register(key);
    }
}

/// Checks whether production public keys have been provisioned.
pub fn is_production_ready() -> bool {
    global_key_ring()
        .read()
        .map(|r| r.is_production_provisioned())
        .unwrap_or(false)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_production_key_is_explicitly_unconfigured() {
        let key = lookup_key("prod-2026-v2").expect("prod key placeholder must exist");
        assert_eq!(key.status, KeyStatus::Unconfigured);
        assert!(key.public_key_raw.is_empty());
        assert!(!key.is_usable_at(1800000000));
        assert!(!is_production_ready());
    }

    #[test]
    fn test_staging_key_is_usable() {
        let key = lookup_key("test-staging-2026").expect("staging key must exist");
        assert_eq!(key.status, KeyStatus::Active);
        assert_eq!(key.public_key_raw.len(), 32);
        assert!(key.is_usable_at(1775000000));
    }
}
