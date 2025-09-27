// priority: 0

// // kubejs/server_scripts/ships/75_helm_replacer.js
// When a ship starts being tracked successfully, search for vs_sails:helm_block,
// break it, then replace it after 1 second with proper neighbor updates

var BlockPos = Java.loadClass('net.minecraft.core.BlockPos');

function logHelm(msg){
  if (!global.TRACK_DBG && !global.DEBUG && !(global.Ships_CFG && global.Ships_CFG.DEBUG)) return;
  try { console.log('[Ships/Helm] ' + msg); } catch(_){ }
}

function tellServer(server, text) { 
  try { server.tell(text); } catch(e){} 
}

function errHelm(server, msg) { 
  tellServer(server, Text.red('[Ships/Helm] ' + msg)); 
}

// KubeJS server scheduler helper
function scheduleHelm(server, ticks, fn){
  try { server.scheduleInTicks(ticks, fn); }
  catch(e){ errHelm(server, 'scheduleInTicks failed: '+e); }
}

/**
 * Search the entire ship for vs_sails:helm_block blocks
 * @param {*} level - The level/world
 * @param {*} ship - The ship object
 * @param {*} st - Ship tracking state object
 * @returns Array of {x, y, z} positions where helm blocks were found
 */
function findHelmBlocks(level, ship, st) {
  var helmBlocks = [];
  
  try {
    // Get ship bounds using the same method as kubevs_tracker
    var searchBounds = null;
    
    // Try to get ship AABB first - this is the exact method used in kubevs_tracker
    if (ship && typeof ship.getShipAABB === 'function') {
      var aabb = ship.getShipAABB();
      if (aabb) {
        logHelm('findHelmBlocks using ship AABB: minX='+aabb.minX+' minY='+aabb.minY+' minZ='+aabb.minZ+' maxX='+aabb.maxX+' maxY='+aabb.maxY+' maxZ='+aabb.maxZ);
        
        // Use AABB coordinates directly - they are exact ship-space block coordinates
        searchBounds = {
          minX: Math.floor(aabb.minX),
          minY: Math.floor(aabb.minY),
          minZ: Math.floor(aabb.minZ),
          maxX: Math.ceil(aabb.maxX),
          maxY: Math.ceil(aabb.maxY),
          maxZ: Math.ceil(aabb.maxZ)
        };
        
        logHelm('findHelmBlocks ship-space bounds: '+searchBounds.minX+','+searchBounds.minY+','+searchBounds.minZ+' to '+searchBounds.maxX+','+searchBounds.maxY+','+searchBounds.maxZ);
        
        // Calculate dimensions for verification
        var width = searchBounds.maxX - searchBounds.minX + 1;
        var height = searchBounds.maxY - searchBounds.minY + 1;
        var length = searchBounds.maxZ - searchBounds.minZ + 1;
        logHelm('findHelmBlocks ship dimensions: '+width+'x'+height+'x'+length+' blocks');
        
      } else {
        logHelm('findHelmBlocks ship.getShipAABB() returned null');
      }
    } else {
      logHelm('findHelmBlocks ship.getShipAABB is not available');
    }
    
    // Fallback to center-based search if AABB not available
    if (!searchBounds) {
      logHelm('findHelmBlocks falling back to center-based search');
      
      var shipCenter = null;
      try {
        if (st.lastCenterShip) {
          shipCenter = st.lastCenterShip;
        } else if (global.KubeVS && global.KubeVS.shipCenterShip) {
          shipCenter = global.KubeVS.shipCenterShip(ship);
        }
      } catch(e) {
        logHelm('findHelmBlocks failed to get ship center: ' + e);
        return helmBlocks;
      }
      
      if (!shipCenter) {
        logHelm('findHelmBlocks no ship center available');
        return helmBlocks;
      }
      
      // Define search bounds around ship center
      var searchRadius = 50; // Reasonable search radius for a ship
      searchBounds = {
        minX: Math.floor(shipCenter.x - searchRadius),
        maxX: Math.floor(shipCenter.x + searchRadius),
        minY: Math.floor(shipCenter.y - searchRadius),
        maxY: Math.floor(shipCenter.y + searchRadius),
        minZ: Math.floor(shipCenter.z - searchRadius),
        maxZ: Math.floor(shipCenter.z + searchRadius)
      };
      
      logHelm('findHelmBlocks fallback bounds: ' + searchBounds.minX + ',' + searchBounds.minY + ',' + searchBounds.minZ + ' to ' + searchBounds.maxX + ',' + searchBounds.maxY + ',' + searchBounds.maxZ);
    }
    
    var blocksChecked = 0;
    var maxBlocksToCheck = 50000; // Increase limit for proper ship scanning
    
    // Search through the ship space
    for (var y = searchBounds.minY; y <= searchBounds.maxY && blocksChecked < maxBlocksToCheck; y++) {
      for (var x = searchBounds.minX; x <= searchBounds.maxX && blocksChecked < maxBlocksToCheck; x++) {
        for (var z = searchBounds.minZ; z <= searchBounds.maxZ && blocksChecked < maxBlocksToCheck; z++) {
          blocksChecked++;
          
          var blockPos = new BlockPos(x, y, z);
          var blockState = level.getBlockState(blockPos);
          
          // Skip air blocks
          if (blockState.isAir()) continue;
          
          // Check if this is a helm block
          var block = blockState.getBlock();
          var isHelmBlock = false;
          
          // Method 1: Try blockState.is() first (recommended KubeJS method)
          try {
            if (typeof blockState.is === 'function') {
              isHelmBlock = blockState.is('vs_sails:helm_block');
            }
          } catch(e) {
            // If .is() method fails, continue to other methods
          }
          
          // Method 2: Try block.getId() comparison
          if (!isHelmBlock) {
            try {
              var blockId = block.getId();
              isHelmBlock = (blockId === 'vs_sails:helm_block');
            } catch(e) {
              // If getId() fails, continue to fallback
            }
          }
          
          // Method 3: Fallback to toString() comparison (original method)
          if (!isHelmBlock) {
            try {
              var blockName = block.toString();
              isHelmBlock = (blockName === 'vs_sails:helm_block');
            } catch(e) {
              // All methods failed, skip this block
            }
          }
          
          if (isHelmBlock) {
            helmBlocks.push({x: x, y: y, z: z, blockState: blockState});
            logHelm('findHelmBlocks found helm block at (' + x + ',' + y + ',' + z + ')');
          }
        }
      }
    }
    
    logHelm('findHelmBlocks checked ' + blocksChecked + ' blocks, found ' + helmBlocks.length + ' helm blocks');
    
  } catch(e) {
    logHelm('findHelmBlocks error: ' + e);
  }
  
  return helmBlocks;
}

/**
 * Break a helm block and replace it after a delay
 * @param {*} level - The level/world
 * @param {*} server - The server
 * @param {*} x - Block X coordinate in ship space
 * @param {*} y - Block Y coordinate in ship space  
 * @param {*} z - Block Z coordinate in ship space
 * @param {*} originalBlockState - The original block state to restore
 */
function breakAndReplaceHelmBlock(level, server, x, y, z, originalBlockState) {
  try {
    var blockPos = new BlockPos(x, y, z);
    
    // Verify the block is still a helm block
    var currentBlockState = level.getBlockState(blockPos);
    var isCurrentlyHelmBlock = false;
    
    // Use the same multi-method approach for verification
    try {
      if (typeof currentBlockState.is === 'function') {
        isCurrentlyHelmBlock = currentBlockState.is('vs_sails:helm_block');
      }
    } catch(e) {}
    
    if (!isCurrentlyHelmBlock) {
      try {
        var currentBlock = currentBlockState.getBlock();
        var currentBlockId = currentBlock.getId();
        isCurrentlyHelmBlock = (currentBlockId === 'vs_sails:helm_block');
      } catch(e) {}
    }
    
    if (!isCurrentlyHelmBlock) {
      try {
        var currentBlockName = currentBlockState.getBlock().toString();
        isCurrentlyHelmBlock = (currentBlockName === 'vs_sails:helm_block');
      } catch(e) {}
    }
    
    if (!isCurrentlyHelmBlock) {
      logHelm('breakAndReplaceHelmBlock block at (' + x + ',' + y + ',' + z + ') is no longer a helm block, skipping');
      return;
    }
    
    logHelm('breakAndReplaceHelmBlock breaking helm block at (' + x + ',' + y + ',' + z + ')');
    
    // Break the block (set to air)
    var Blocks = Java.loadClass('net.minecraft.world.level.block.Blocks');
    level.setBlock(blockPos, Blocks.AIR.defaultBlockState(), 3); // Update flag 3 = update & notify
    
    // Schedule replacement after 20 ticks (1 second)
    scheduleHelm(server, 20, function() {
      try {
        logHelm('breakAndReplaceHelmBlock replacing helm block at (' + x + ',' + y + ',' + z + ')');
        
        // Place the block back with the same block state
        level.setBlock(blockPos, originalBlockState, 3); // Update flag 3 = update & notify
        
        // Force neighbor updates (simulate player placement)
        try {
          level.blockUpdated(blockPos, originalBlockState.getBlock());
          level.updateNeighborsAt(blockPos, originalBlockState.getBlock());
          
          // Update neighbors in all 6 directions
          var directions = [
            {x: 1, y: 0, z: 0},  // East
            {x: -1, y: 0, z: 0}, // West
            {x: 0, y: 1, z: 0},  // Up
            {x: 0, y: -1, z: 0}, // Down
            {x: 0, y: 0, z: 1},  // South
            {x: 0, y: 0, z: -1}  // North
          ];
          
          for (var i = 0; i < directions.length; i++) {
            var dir = directions[i];
            var neighborPos = new BlockPos(x + dir.x, y + dir.y, z + dir.z);
            level.neighborChanged(neighborPos, originalBlockState.getBlock(), blockPos);
          }
          
          logHelm('breakAndReplaceHelmBlock successfully replaced and updated neighbors for helm block at (' + x + ',' + y + ',' + z + ')');
          
        } catch(neighborErr) {
          logHelm('breakAndReplaceHelmBlock neighbor update failed: ' + neighborErr);
        }
        
      } catch(replaceErr) {
        logHelm('breakAndReplaceHelmBlock replacement failed: ' + replaceErr);
      }
    });
    
  } catch(e) {
    logHelm('breakAndReplaceHelmBlock error: ' + e);
  }
}

/**
 * Process helm block replacement for a newly tracked ship
 * @param {*} level - The level/world
 * @param {*} server - The server
 * @param {*} ship - The ship object
 * @param {*} st - Ship tracking state object
 */
function processHelmReplacement(level, server, ship, st) {
  try {
    logHelm('processHelmReplacement starting for ship ' + st.id);
    
    // Find all helm blocks on the ship
    var helmBlocks = findHelmBlocks(level, ship, st);
    
    if (helmBlocks.length === 0) {
      logHelm('processHelmReplacement no helm blocks found on ship ' + st.id);
      return;
    }
    
    logHelm('processHelmReplacement found ' + helmBlocks.length + ' helm blocks on ship ' + st.id + ', processing...');
    
    // Process each helm block
    for (var i = 0; i < helmBlocks.length; i++) {
      var helmBlock = helmBlocks[i];
      breakAndReplaceHelmBlock(level, server, helmBlock.x, helmBlock.y, helmBlock.z, helmBlock.blockState);
    }
    
  } catch(e) {
    logHelm('processHelmReplacement error: ' + e);
  }
}

// Hook into the ship tracking system
// We need to monitor when ships are successfully added to tracking
var originalSHIPS_trackAt = global.SHIPS_trackAt;

if (originalSHIPS_trackAt && typeof originalSHIPS_trackAt === 'function') {
  global.SHIPS_trackAt = function(level, x, y, z) {
    // Call the original function
    originalSHIPS_trackAt(level, x, y, z);
    
    var server = level.server;
    
    // Schedule a check after the tracking completes
    // The original function schedules work after TRACK_CFG.settleTicks
    // We'll check a bit after that to see if tracking was successful
    var TRACK_CFG = global.TRACK_CFG || { settleTicks: 40 };
    var checkDelay = TRACK_CFG.settleTicks + 10; // Wait for original tracking plus a buffer
    
    scheduleHelm(server, checkDelay, function() {
      try {
        // Check if a ship was successfully tracked at this location
        var SHIPS_TRACK = global.SHIPS_TRACK || {};
        
        // Find any recently tracked ships (within the last few seconds)
        var currentTime = Date.now();
        var recentThreshold = 10000; // 10 seconds
        
        for (var shipId in SHIPS_TRACK) {
          var st = SHIPS_TRACK[shipId];
          if (!st || !st.ship || !st.level) continue;
          
          // Check if this ship is near the tracking location
          var anchorX = st.anchorX || 0;
          var anchorY = st.anchorY || 0;
          var anchorZ = st.anchorZ || 0;
          
          var distance = Math.sqrt(
            Math.pow(anchorX - x, 2) + 
            Math.pow(anchorY - y, 2) + 
            Math.pow(anchorZ - z, 2)
          );
          
          // If the ship is close to where we started tracking (within 100 blocks)
          if (distance <= 100) {
            logHelm('Found recently tracked ship ' + shipId + ' near tracking location (' + x + ',' + y + ',' + z + '), processing helm replacement');
            processHelmReplacement(st.level, server, st.ship, st);
            break; // Only process the first matching ship
          }
        }
        
      } catch(hookErr) {
        logHelm('Ship tracking hook error: ' + hookErr);
      }
    });
  };
  
  logHelm('Helm replacer hooked into SHIPS_trackAt successfully');
} else {
  logHelm('Warning: Could not hook into SHIPS_trackAt - original function not found or not a function');
}

// Expose functions for debugging/manual use
global.HELM_findHelmBlocks = findHelmBlocks;
global.HELM_processHelmReplacement = processHelmReplacement;
global.HELM_breakAndReplaceHelmBlock = breakAndReplaceHelmBlock;

logHelm('Helm replacer module loaded');
