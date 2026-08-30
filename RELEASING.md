# Releasing Project Parity

Project Parity publishes `@project-parity/js` to npm and `project-parity` to PyPI. The Python import remains `parity_py`.

## One-time registry setup

1. Create or claim the `@project-parity` npm organization under the maintainer account.
2. Configure npm Trusted Publisher for `@project-parity/js` with GitHub owner `XxVoidicxX`, repository `project-parity`, workflow `release.yml`, environment `release`, and permission to publish.
3. Configure a pending PyPI Trusted Publisher for `project-parity` with the same GitHub owner, repository, workflow filename, and environment. Pending configuration lets the first trusted release create the PyPI project.
4. In GitHub repository settings, create a `release` environment and require a maintainer approval before deployment.

Trusted publishing uses short-lived OpenID Connect credentials. Do not add npm or PyPI publishing tokens as repository secrets.

## Release process

1. Update all package versions together, `README.md`, `TEST_REPORT.md`, and `CHANGELOG.md`.
2. Run the full local gate:

```sh
npm test
npm pack --workspace=@project-parity/js --dry-run
python -m pip install --upgrade build
python -m build parity-py
```

3. Create and push a matching annotated tag:

```sh
git tag -a v1.7.1 -m "Release v1.7.1"
git push origin v1.7.1
```

4. Approve the `release` environment in GitHub. The workflow validates the tag and all package versions, runs the full test suite, publishes the npm workspace, builds Python distributions, then publishes them to PyPI.

## Verify the published release

```sh
npm view @project-parity/js version
python -m pip index versions project-parity
```

Install the release in fresh test environments before announcing it:

```sh
npm install @project-parity/js discord.js
pip install project-parity[discord]
```
