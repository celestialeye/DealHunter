# Outbound action runner

The `Execute approved outbound action` workflow executes supported GitHub
issues after the `approval:approved` label is added. The executor only accepts
Target product URLs and only adds one item to the cart. It does not implement
checkout or purchasing.

## Runner requirements

Register a self-hosted runner for this repository with these labels:

```text
self-hosted, Windows, X64, target-shopping
```

Run the agent under the same interactive Windows account that owns the Chrome
profile and has Node.js 24 installed.

## Chrome profile access

The preferred mode is an existing Chrome instance with remote debugging
enabled. Set the repository variable `TARGET_CHROME_CDP_URL` to its endpoint,
for example:

```text
http://127.0.0.1:9222
```

The endpoint must belong to a headed Google Chrome instance using the intended
profile. The executor rejects Microsoft Edge and headless test-browser
endpoints.

If that variable is not set, the runner launches installed Chrome with a
persistent profile. Chrome must be closed before execution. The defaults are:

```text
TARGET_CHROME_USER_DATA_DIR=%LOCALAPPDATA%\Google\Chrome\User Data
TARGET_CHROME_PROFILE=Default
```

Set repository variables with those names when the profile uses another
location or profile directory.

## Manual execution

Use **Actions > Execute approved outbound action > Run workflow** and provide
the number of an open issue carrying the `approval:approved` label. Successful
actions add a completion comment and close the issue. Failures leave the issue
open and add an error comment.
