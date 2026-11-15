# unicode

### Requirement: unicode

Preserve every byte of valid UTF-8 input. Append one LF only if the input does not end with LF. Do not normalise Unicode.

Use `node app.cjs`. Read stdin once; write no stderr. Exit 0 unless this requirement specifies another code.
Input is valid UTF-8. No network, filesystem writes or dependencies are needed.
