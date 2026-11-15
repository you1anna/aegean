# json-field

### Requirement: json-field

Parse the entire input as JSON. Accept only a non-null, non-array object with a string value field. Print that field followed by LF. Reject all other input with exit code 2 and empty stdout. Extra object fields are allowed.

Use `node app.cjs`. Read stdin once; write no stderr. Exit 0 unless this requirement specifies another code.
Input is valid UTF-8. No network, filesystem writes or dependencies are needed.
