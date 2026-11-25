# Pending small issues

Findings deferred from the final reviews of plans 1–4 and the server list, ranked by their
impact on the user. An item is removed from here once it is fixed. Last updated: 2026-11-25.

## Low priority: edge cases and looks

1. **Theoretical risks:** a TOCTOU between `realpath` and `open` when reading files, and
    unbounded reads of a growing file; releasing the busy lock depends on the refresh not
    throwing; `process.env` is modified after startup; in a SHA-256 repo with no commits the
    diff base is wrong. (plan 1, 2, 4)
