# Clean-Room & Evidence Rules

## Clean-Room Rules
- Specs describe **behavior only**: requirements, data flows, edge cases, error handling, test cases.
- Never include original source code, variable/function names, file paths, assets, or proprietary details.
- The Builder agent has zero access to the original application or REA tools.
- All analysis stays local.

## Evidence Tagging
Every claim must be labeled:
- **CONFIRMED**: Directly seen in code, files, or runtime with reproducible evidence.
- **INFERRED**: Logical conclusion from available evidence.
- **UNKNOWN**: Insufficient evidence.

Include references (files, offsets, traces) when possible.

## Authorization
Only examine software you own or are authorized to analyze.
