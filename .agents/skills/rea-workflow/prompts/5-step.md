# 5-Step Prompt Templates

## 1. Look
I want to understand how [FEATURE] works in [APP] at [PATH / URL]. Tell me what kind of app it is and which REA tool fits. Give a short overview first, no deep analysis yet.

## 2. Understand
Investigate [FEATURE] with REA. In plain English: what happens step by step, what data it uses, how the pieces connect. Mark each finding CONFIRMED, INFERRED or UNKNOWN, with evidence.

## 3. Plan
Write a build spec for my own version. Behaviour only: requirements, data, edge cases, errors, test cases. No original code, names or assets. Save as spec.md.

## 4. Build
Read spec.md. Build it in [PROJECT PATH] with [TECH STACK], step by step, testing as you go. Then run every test case and show me the results.

## 5. Iterate
Give me 3 things the original does well that mine must keep, 3 weaknesses, and how mine can be better. Update spec.md. Tip: run it on a /loop.
