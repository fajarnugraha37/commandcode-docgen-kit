Run the global DocGen P3 workspace orchestrator from the current directory:

```bash
node ~/.commandcode/docgen/bin/docgen.mjs workspace $ARGUMENTS
```

On native Windows use:

```powershell
node "$env:USERPROFILE\.commandcode\docgen\bin\docgen.mjs" workspace $ARGUMENTS
```

Common operations:

- `/docgen-workspace init .`
- `/docgen-workspace add ../quote-service --domain quoting`
- `/docgen-workspace all`
- `/docgen-workspace impact quote-service`
