param([switch]$Force,[switch]$DryRun,[switch]$NoHooks,[switch]$NoLinkCli,[string]$CommandCodeHome,[string]$ProjectLocal)
$ArgsList=@()
if($Force){$ArgsList+='--force'}
if($DryRun){$ArgsList+='--dry-run'}
if($NoHooks){$ArgsList+='--no-hooks'}
if($NoLinkCli){$ArgsList+='--no-link-cli'}
if($CommandCodeHome){$ArgsList+='--commandcode-home';$ArgsList+=$CommandCodeHome}
if($ProjectLocal){$ArgsList+='--project-local';$ArgsList+=$ProjectLocal}
node (Join-Path $PSScriptRoot 'install.mjs') @ArgsList
exit $LASTEXITCODE
