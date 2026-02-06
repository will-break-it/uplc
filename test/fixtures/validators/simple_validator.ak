/// Simple validator - always succeeds
/// Tests: basic validator structure detection
validator simple_validator {
  spend(_datum: Option<Data>, _redeemer: Data, _own_ref: Data, _tx: Data) {
    True
  }

  else(_) {
    fail
  }
}
