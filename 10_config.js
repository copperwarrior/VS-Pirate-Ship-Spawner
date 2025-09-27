// ships/10_config.js
// Shared config + globals

var CFG = {
  DEBUG:                   false,  // Debug disabled by default, enable with /ships debug on
  TICKS_BETWEEN_TRIES:     120 * 60 * 20, // 144000 (every ~120 minutes)
  TRIES_PER_PLAYER:        6,
  MIN_RADIUS:              96,
  MAX_RADIUS:              384,
  REQUIRE_LOADED:          true,
  LOADED_RADIUS_BLOCKS:    192,
  CHANCE:                  0.12,
  STRUCTURE_ID:            'pirates_sails:ship',
  MIN_WATER_DEPTH:         4,
  WATER_PAD_RADIUS:        2,
  Y_SCAN_TOP:              128,
  Y_SCAN_BOTTOM:           0,
  
  // Decay system configuration
  DECAY_START_TICKS:       60,     // Initial delay between chunks (3 seconds)
  DECAY_END_TICKS:         5,     // Final delay between chunks (1.0 seconds)
  DECAY_ACCELERATION:      50,     // How many chunks to reach max speed
  DECAY_DEFAULT_BOUNDS:    50,     // Default ship bounds when AABB unavailable
  DECAY_DEFAULT_HEIGHT:    20,     // Default ship height when AABB unavailable
  
  // Floodfill decay limits
  DECAY_FLOODFILL_START:   15,     // Starting floodfill size for main decay (blocks)
  DECAY_FLOODFILL_END:     75,     // Ending floodfill size for main decay (blocks)
  SAIL_FLOODFILL_SIZE:     47,     // Fixed floodfill size for sail decay (blocks)
  
  // Barrel cleanup
  BARREL_DESPAWN_MINUTES:  30      // Minutes before barrels despawn (0 = never despawn)
};

var tickCounter = 0;

// expose on the Rhino global for cross-file use
global.Ships_CFG = CFG;
global.Ships_tickCounter = function(){ return tickCounter; };
global.Ships__setTick = function(v){ tickCounter = v|0; };
