# invalid-json

### Requirement: invalid-json

Parse the entire input as JSON. For any valid JSON value, exit 0 with empty stdout. For malformed JSON, exit 2 with empty stdout.

Use `node app.cjs`. Read stdin once; write no stderr. Exit 0 unless this requirement specifies another code.
Input is valid UTF-8. No network, filesystem writes or dependencies are needed.
