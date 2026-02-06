use aiken/collection/list
use aiken/crypto.{VerificationKeyHash}
use cardano/transaction.{Transaction}

/// Validator requiring a specific signature
/// Tests: signature check detection
validator signature_check(owner: VerificationKeyHash) {
  spend(_datum: Option<Data>, _redeemer: Data, _own_ref: Data, tx: Transaction) {
    list.has(tx.extra_signatories, owner)
  }
}
