# KubeJS Valkyrien Skies Ship System

i forced the robots to make this for me

they even wrote this readme.md

all i claim is the concept and game design

## Features

### Dynamic Ship Spawning
- **Intelligent Positioning**: Ships spawn in deep water areas around players using configurable radius rings
- **Water Depth Validation**: Ensures ships spawn in appropriate water depths with sufficient clearance
- **Configurable Rates**: Adjustable spawn frequency, chances, and player limits

### Advanced Ship Tracking
- **Real-time Monitoring**: Tracks all active ships
- **State Management**: Maintains ship centers, boundaries, and metadata across server restarts
- **Performance Optimized**: Efficient tracking system that scales with world size

### ⚡ Progressive Decay System
- **Victory Sinking**: Defeating all pirates on board a ship will cause the ship to start collapsing
- **Accelerating Decay**: Ships decay with increasing speed over time for dramatic effect
- **Intelligent Block Removal**: Uses floodfill algorithms to remove connected ship blocks naturally
- **Sail-Specific Logic**: Special handling for sail blocks with separate decay parameters
- **Configurable Timing**: Fully adjustable decay speeds and patterns

### 🛢️ Physics-Enabled Salvage
- **Barrel Ship Creation**: Creates individual physics-enabled barrels during decay
- **Underwater Placement**: Barrels spawn underwater with random rotations
- **Persistent Tracking**: Barrel ships are tracked and can be configured to despawn after set time

## Installation

1. **Prerequisites**:
   - KubeJS 6.x or higher
   - KubeVS
   - VS Pirates
   - VS Sails
   - Supplementaries (bag rip sfx for the sails so not rly required you'd have to change the sfx if you don't want it)

2. **Installation**:
   - Copy all files to `kubejs/server_scripts/ships/` in your modpack
   - Restart the server to load the scripts
   - Configure settings in `10_config.js` as needed

## Configuration

### Main Configuration (`10_config.js`)

```javascript
var CFG = {
  DEBUG: false,                    // Enable debug logging
  TICKS_BETWEEN_TRIES: 144000,     // Time between spawn attempts (120 minutes)
  TRIES_PER_PLAYER: 6,             // Max attempts per player per cycle
  MIN_RADIUS: 96,                  // Minimum spawn distance from players
  MAX_RADIUS: 384,                 // Maximum spawn distance from players
  CHANCE: 0.12,                    // Base spawn chance (12%)
  STRUCTURE_ID: 'pirates_sails:ship', // Structure to spawn
  MIN_WATER_DEPTH: 4,              // Required water depth
  
  // Decay System
  DECAY_START_TICKS: 60,           // Initial decay speed (3 seconds)
  DECAY_END_TICKS: 5,              // Final decay speed (0.25 seconds)
  DECAY_ACCELERATION: 50,          // Chunks to reach max speed
  
  // Floodfill Limits
  DECAY_FLOODFILL_START: 15,       // Starting floodfill size
  DECAY_FLOODFILL_END: 75,         // Ending floodfill size
  SAIL_FLOODFILL_SIZE: 47,         // Sail-specific floodfill size
  
  // Barrel Cleanup
  BARREL_DESPAWN_MINUTES: 30       // Barrel despawn time (0 = never)
};
```

## Commands

All commands require OP level 2 or higher and use the `/ships` prefix:

### Spawning Commands
- `/ships check` - Run spawn cycle with verbose output
- `/ships force` - Force spawn ships with 100% chance
- `/ships stop` - Stop all ship spawning
- `/ships start` - Resume ship spawning

### Tracking Commands
- `/ships track list` - List all tracked ships
- `/ships track status` - Show tracking system status
- `/ships track info <shipId>` - Get detailed ship information

### Decay Commands
- `/ships decay <shipId>` - Start decay sequence for specific ship
- `/ships decay stop <shipId>` - Stop decay for specific ship
- `/ships decay reset <shipId>` - Reset decay progress
- `/ships decay info <shipId>` - Show decay status and progress

### Barrel Commands
- `/ships barrels status` - Show barrel tracking status
- `/ships barrels cleanup` - Manually clean up aged barrels
- `/ships barrels process` - Process barrel aging

### Debug Commands
- `/ships debug on/off` - Toggle debug mode
- `/ships debug stats` - Show system statistics
- `/ships bounds <shipId>` - Display ship boundaries
- `/ships center <shipId>` - Show ship center coordinates

## Contributing

feel free to make pull requests

## License

the robot wrote this so idrc what you do with it