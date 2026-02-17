use aiken/builtin

validator script {
 spend(datum: Option<Data>, redeemer: Data, ctx: Data, tx: Data) {
  {
  let f = fn(g) {
    let h = fn(i) { g(fn(j) { i(j) }) }
    g(fn(i) { h(h, i) })
  }
  True
  } == True
 }
}