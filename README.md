# Wheels Router MCP Server

Built with [MatthewDailey/mcp-starter](https://github.com/MatthewDailey/mcp-starter/)

A [Model Context Protocol](https://modelcontextprotocol.io) server for Hong Kong public transit routing. Provides tools to search locations and plan trips using the [Wheels Router API](https://engine.justusewheels.com).

## Features

- **Location Search**: Find places in Hong Kong using OpenStreetMap Nominatim
- **Trip Planning**: Get public transit routes with MTR, bus, ferry, and walking directions

## Installation

### With npm

```bash
npm install -g wheels-router-mcp
```

#### Claude Desktop

Add to your config (`~/Library/Application Support/Claude/claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "wheels-router": {
      "command": "wheels-router-mcp"
    }
  }
}
```

#### OpenCode

Add to your OpenCode config:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "wheels-router": {
      "type": "local",
      "command": ["npx", "-y", "wheels-router-mcp"],
      "enabled": true
    }
  }
}
```

### From Source

1. Clone and build:

```bash
git clone https://github.com/wheelstransit/wheels-router-mcp
cd wheels-router-mcp
npm install
npm run build
```

2. Add to your preferred tool's config:

**Claude Desktop:**

```json
{
  "mcpServers": {
    "wheels-router": {
      "command": "node",
      "args": ["/absolute/path/to/wheels-router-mcp/dist/index.cjs"]
    }
  }
}
```

**OpenCode:**

```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "wheels-router": {
      "type": "local",
      "command": ["node", "/absolute/path/to/wheels-router-mcp/dist/index.cjs"],
      "enabled": true
    }
  }
}
```

3. Restart your application

## Available Tools

### `search_location`

Search for places in Hong Kong.

**Parameters:**
- `query` (string, required): Place name (e.g., "Yau Tong MTR Exit A2")
- `limit` (number, optional): Max results (1-10, default: 5)

**Example:**
```
Find "Tsim Sha Tsui"
```

### `plan_trip`

Plan a public transit trip in Hong Kong.

**Parameters:**
- `origin` (string, required): Starting point as `lat,lon` or `stop:ID`
- `destination` (string, required): Destination as `lat,lon` or `stop:ID`
- `depart_at` (string, optional): ISO 8601 departure time
- `arrive_by` (string, optional): ISO 8601 arrival deadline
- `modes` (string, optional): Comma-separated modes (e.g., `mtr,bus,ferry`)
- `max_results` (number, optional): Max route plans (1-5)

**Example:**
```
Plan a trip from 22.3193,114.2644 to 22.2783,114.1747
```

## Development

Run with Inspector for testing:

```bash
npm run dev
```

This starts both the file watcher and MCP Inspector.

## License

See [LICENSE](LICENSE)