# Pinnacle Professional Inventory UI

A visual inventory layout tool that lets you map out warehouse locations on a canvas and check their status against a PinPro server.

## What it does

- Drag-and-drop locations, text, and lines on an infinite canvas
- Batch create locations with numbered or lettered suffixes
- Sync locations against a PinPro server to see what's stored where
- Click a location to see its items in a side panel
- Everything saves to localStorage so you don't lose your work

![canvas view](/dist/canvas_view.png)

## Using the App
## Setup

To setup open the settings panel on the dock and fill in the server url as "http://SERVER-IP-HERE" eg; http://192.168.0.100 , if the server URL is unknown try "http://pinpro" on a pinnacle setup computer.

Then click Fetch and select your yard

After that username and password can be filled in 

**IMPORTANT** Ensure you have a username and password is registered and can be used in Barcode Scanner Pro

## Adding Locations

To add locations select the location icon on the bottom dock.

When entering in a location its important to include "1-" in the location, for example if your printed location tag reads as "HEADLAMPS L2" , ensure the location entered into the app is "1-HEADLAMPS L2"

After locations are added the refresh icon can be pressed to scan the current locations.

![location full](/dist/location_full.png)
![location empty](/dist/location_empty.png)
![row named](/dist/row_named.png)

### Dev Setup

Ensure [Node.js](https://nodejs.org/) (v18+) and [Rust](https://www.rust-lang.org/tools/install) installed
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

# Licence
MIT
