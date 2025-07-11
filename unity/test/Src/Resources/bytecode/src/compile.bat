v8cc unhandled_rejection.mjs --hash_seed=1
v8cc encdec.mjs --hash_seed=1
v8cc console_log_test.mjs --hash_seed=1
v8cc a_mjs.mjs --hash_seed=1
v8cc a_cjs.cjs --hash_seed=1

move unhandled_rejection.mbc ..\unhandled_rejection.bytes
move encdec.mbc ..\encdec.bytes
move console_log_test.mbc ..\console_log_test.bytes
move a_mjs.mbc ..\a_mjs.bytes
move a_cjs.cbc ..\a_cjs.bytes