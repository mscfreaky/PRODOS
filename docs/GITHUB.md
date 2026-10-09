# Upload to GitHub

Use the **Source ZIP**, not the Windows ZIP, for your repository.

1. Extract the source ZIP.
2. Create an empty GitHub repository named `PRODOS`, choose Public, and do not add a second README or license.
3. Upload the **contents** of the extracted `PRODOS-1.0.0` folder to the repository root. Include dotfiles such as `.gitignore` and `.github` when using Git or GitHub Desktop. Do not upload the outer ZIP as the only repository file.
4. Commit the files. The included MIT license and README are already prepared.
5. Create a release tagged `v1.0.0`. Attach the Windows x64 ZIP and SHA256 checksums there. Optionally attach the source ZIP too.

GitHub Desktop alternative: add the extracted directory as a local repository, commit its contents, then Publish repository with private visibility disabled.

Do not commit `node_modules`, `publish`, `bin`, `obj`, test output, personal show data, QR credentials, ATEM state dumps or private exports. The supplied source archive excludes generated dependencies and personal runtime files. `.gitignore` is a convenience, not a substitute for reviewing newly added files.

The included GitHub Actions workflow restores Node dependencies, runs backend tests and builds the Windows application. Physical ATEM and real internet tunnel checks remain manual. A public repository upload has not been performed by the release preparation process.
