# line-limit

### Requirement: line-limit

Count all input bytes, including LF, in UTF-8. If the count exceeds 128, exit 2 with empty stdout. Otherwise echo the input exactly and exit 0.

Use `node app.cjs`. Read stdin once; write no stderr. Exit 0 unless this requirement specifies another code.
Input is valid UTF-8. No network, filesystem writes or dependencies are needed.
