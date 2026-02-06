/// Test 001: Always True validator
/// The simplest possible validator - always succeeds

validator always_true {
  spend(_datum: Option<Data>, _redeemer: Data, _output_ref: Data, _tx: Data) {
    True
  }
}
