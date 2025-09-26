// ships/10_config.js
// Shared config + globals

var CFG = {
  DEBUG:                   true,
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
  Y_SCAN_BOTTOM:           0
};

var tickCounter = 0;

// expose on the Rhino global for cross-file use
global.Ships_CFG = CFG;
global.Ships_tickCounter = function(){ return tickCounter; };
global.Ships__setTick = function(v){ tickCounter = v|0; };
