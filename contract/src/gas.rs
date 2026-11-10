//! Gas budgets and fixed deposits. Never inline these numbers at a call site.

use near_sdk::{Gas, NearToken};

/// NEP-141 requires exactly 1 yoctoNEAR on `ft_transfer`.
pub const ONE_YOCTO: NearToken = NearToken::from_yoctonear(1);

/// NEP-145 registration on a NEP-141 token. 0.00125 NEAR covers USDC on NEAR.
/// Attached when registering the issuer at mint so the first payout can be pushed
/// instead of falling back to `claimable`.
pub const FT_STORAGE_DEPOSIT: NearToken = NearToken::from_yoctonear(1_250_000_000_000_000_000_000);

pub const GAS_FT_TRANSFER: Gas = Gas::from_tgas(10);
pub const GAS_FT_STORAGE_DEPOSIT: Gas = Gas::from_tgas(10);
pub const GAS_ON_PAYOUT: Gas = Gas::from_tgas(10);
pub const GAS_ON_WITHDRAW_RESOLVE: Gas = Gas::from_tgas(10);
