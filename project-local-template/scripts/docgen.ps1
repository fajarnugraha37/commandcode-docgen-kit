param([Parameter(ValueFromRemainingArguments=$true)][string[]]$Args)
$ErrorActionPreference = "Stop"
node "$PSScriptRoot\docgen.mjs" @Args
