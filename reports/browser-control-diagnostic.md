# Browser control startup diagnosis

Checked: 2026-10-10, Windows.

Browser control fails before a browser window can be selected. The sandbox log identifies the failing target as the Codex `cua_node` runtime's `bin/node_repl.exe`.

Recorded errors:

```text
runtime read/execute validation failed
open ACL target for root-only update
The process cannot access the file because it is being used by another process. (os error 32)
setup refresh had errors
```

Two node_repl processes were present, started around 04:21, before the failed attempts around 05:44. This does not establish which process holds the conflicting file handle.

The browser tool reset and retry did not repair the startup failure. No Brave profile, browser cookies, access controls, or Windows security settings were changed. No application processes were terminated.

Next recovery step: fully exit and reopen the Codex desktop application to release its runtime processes, then test browser control in the same conversation. If the sharing violation persists, restart Windows and retry; this is a recovery attempt, not a guaranteed repair.

Full computer access is unnecessary for this failure. The blocking condition is a runtime file sharing violation, not a missing permission to access the requested website.

Official sandbox troubleshooting: https://learn.chatgpt.com/docs/windows/windows-sandbox

Local source log: `C:/Users/uygar/.codex/.sandbox/sandbox.2026-10-10.log`.
