# Pinnacle Professional Inventory UI

A visual inventory layout tool that lets you map out warehouse locations on a canvas and check their status against a PinPro server.

## What it does

- Drag-and-drop locations, text, and lines on an infinite canvas
- Batch create locations with numbered or lettered suffixes
- Sync locations against a PinPro server to see what's stored where
- Click a location to see its items in a side panel
- Everything saves to localStorage so you don't lose your work

## Setup

Needs [Node.js](https://nodejs.org/) (v18+) and [Rust](https://www.rust-lang.org/tools/install) installed

```bash
npm install
npm run dev
```

## Tauri (desktop build)

```bash
npm run tauri build
```

## API

### Get Sites

**Request**
```
GET {serverUrl}/pinpro/sites
```

**Response** (XML)
```xml
<sites>
  <site>
    <siteId>1</siteId>
    <shortCode>MA</shortCode>
    <yardName>My Yard</yardName>
  </site>
</sites>
```

### Get Location Parts

**Request**
```
GET {serverUrl}/pinpro/locations/parts?siteid=1&locationtag=WD1+R1+L1+A&country=US&language=en
Accept-Encoding: gzip
Authorization: Basic Base64Here
Connection: Keep-Alive
User-Agent: okhttp/3.10.0
```

**Response** (JSON)
```json
[
  {
    "tag": 12345,
    "itemType": "DOOR",
    "vstockNo": "ABC-001"
  }
]
```

**Status mapping:**
- Items found → red
- No items → green
- 404 / error → yellow

## Built with

React, TypeScript, Vite, Tailwind CSS, Canvas API, Tauri

# Licence

