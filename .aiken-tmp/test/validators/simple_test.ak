use aiken/builtin

validator policy {
 mint(_i: Data, _j: Data, _tx: Data) {
   let x = builtin.un_b_data(builtin.head_list({
     expect _headList_arg0: List<Data> = []
     _headList_arg0
   }))
   True
 }
}
EOF && cd .aiken-tmp/test && aiken build