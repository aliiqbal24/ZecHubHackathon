# AgentZcash Release

The release artifact set has two parts:

- npm package tarballs for `@agentzcash/core`, `@agentzcash/mcp-server`, `@agentzcash/dashboard`, and `agentzcash`
- managed Zingo CLI binaries named `agentzcash-zingo-cli-<platform>-<arch>` plus matching `.sha256` files

## Local Package Pack

```bash
npm install
npm run build
npm run release:pack
```

This writes tarballs, checksums, and `agentzcash-release-manifest.json` under `release-artifacts/npm`.

## GitHub Release Assets

Publishing a GitHub release runs `.github/workflows/wallet-binaries.yml`. The workflow builds the managed Zingo CLI assets, packs the npm release tarballs, writes SHA-256 checksums, and uploads all assets to the release.

If the repository has an `NPM_TOKEN` secret, the same workflow publishes the four packages to npm in dependency order. For manual workflow dispatch, set `publish_npm` to `true`; published GitHub releases publish automatically when `NPM_TOKEN` is present. Without `NPM_TOKEN`, the workflow still uploads the tarballs as release assets.

The wallet installer downloads from:

```text
https://github.com/aliiqbal24/ZecHubHackathon/releases/latest/download/agentzcash-zingo-cli-<platform>-<arch>
```

Each binary must have a matching `.sha256` asset at the same URL with `.sha256` appended.

Use workflow dispatch with `release_tag` to attach assets to an existing release tag.
