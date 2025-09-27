// kubejs/server_scripts/ships/70_kubevs_tracker.js
// Valkyrien Skies ship tracker – resolve via AABB, keep centers fresh, prune unloaded ships

var AABB = Java.loadClass('net.minecraft.world.phys.AABB');

var KubeVS = global.KubeVS || null;
if (!KubeVS) {
  console.error('[Ships/Track] global.KubeVS is missing. Ensure ships/30_kubevs.js attaches global.KubeVS (Rhino has no globalThis).');
}

// persistent maps/flags (Rhino-safe)
var SHIPS_TRACK = SHIPS_TRACK || {}; // shipId -> state
var BARREL_TRACK = BARREL_TRACK || {}; // barrelId -> { ship, level, pos, createTime }
var TRACK_DBG   = (typeof TRACK_DBG === 'boolean') ? TRACK_DBG : false; // default: off

function logDetail(msg){
  if (!TRACK_DBG && !global.DEBUG && !(global.Ships_CFG && global.Ships_CFG.DEBUG)) return;
  try { console.log('[Ships/TrackDBG] ' + msg); } catch(_){ }
}

function logTrack(msg){
  if (!TRACK_DBG && !global.DEBUG && !(global.Ships_CFG && global.Ships_CFG.DEBUG)) return;
  try { console.log('[Ships/Track] '+msg); } catch(_){ }
}

// --- config used by the tracker ---
var TRACK_CFG = TRACK_CFG || {
  settleTicks: 40,
  aabb: { rx: 5, ry: 3, rz: 5 }
};

// ---------- tiny utils ----------
function tell(server, text) { try { server.tell(text); } catch(e){} }
function dbg(server, msg)   { if (!TRACK_DBG) return; tell(server, Text.gray('[Ships/Track] ' + msg)); }
function err(server, msg)   { tell(server, Text.red('[Ships/Track] ' + msg)); }

// KubeJS server scheduler helper
function schedule(server, ticks, fn){
  try { server.scheduleInTicks(ticks, fn); }
  catch(e){ err(server, 'scheduleInTicks failed: '+e); }
}

// ---------- ship resolution (AABB-only) ----------
function resolveShipByAabb(level, x, y, z) {
  var rx = TRACK_CFG.aabb.rx, ry = TRACK_CFG.aabb.ry, rz = TRACK_CFG.aabb.rz;
  var box = new AABB(x - rx, y - ry, z - rz, x + rx, y + ry, z + rz);
  
  try {
    var ships = KubeVS.shipsInAABB(level, box);
    if (ships && ships.length > 0) {
      return ships[0]; // Return first ship found
    }
  } catch (e) {
    logDetail('resolveShipByAabb error: ' + e);
  }
  return null;
}

// ---------- tracking functions ----------
function SHIPS_trackAt(level, x, y, z, server) {
  if (!level || !server) return;
  
  logTrack('/shiptrack here ? '+x+','+y+','+z);
  
  var ship = resolveShipByAabb(level, x, y, z);
  if (!ship) {
    err(server, 'No ship found at position');
    return;
  }
  
  var id = KubeVS.shipId(ship);
  if (!id) {
    err(server, 'Ship found but no ID available');
    return;
  }
  
  if (SHIPS_TRACK[id]) {
    dbg(server, 'already tracking ship '+id);
    return;
  }
  
  // Create tracking state
  var st = {
    id: id,
    ship: ship,
    level: level,
    decaying: false,
    decayCompleted: false,
    finalBarrelsCreated: false
  };
  
  SHIPS_TRACK[id] = st;
  dbg(server, 'now tracking ship '+id);
}

function SHIPS_canSpawn() {
  var keys = Object.keys(SHIPS_TRACK || {});
  for (var i = 0; i < keys.length; i++) {
    var st = SHIPS_TRACK[keys[i]];
    if (st && st.ship && st.level) {
      // Check if ship is loaded
      try {
        var center = KubeVS.shipCenterWorld(st.ship);
        if (center) {
          var BlockPos = Java.loadClass('net.minecraft.core.BlockPos');
          var centerPos = new BlockPos(Math.floor(center.x), Math.floor(center.y), Math.floor(center.z));
          if (st.level.isLoaded(centerPos)) {
            // Check for pirates on board
            var pirateCount = _countPiratesOnShip(st.level, st.ship);
            if (pirateCount === 0 && !st.decaying) {
              // Start decay
              _initDecay(st);
            }
            return false; // Don't spawn new ships while this one exists
          }
        }
      } catch (e) {
        logDetail('canSpawn check error for ship '+st.id+': '+e);
      }
    }
  }
  return true; // Can spawn new ships
}

function SHIPS_removeOldShips() {
  var removed = 0;
  var keys = Object.keys(SHIPS_TRACK || {});
  
  keys.forEach(function(id) {
    var st = SHIPS_TRACK[id];
    if (!st || !st.ship || !st.level) return;
    
    try {
      var center = KubeVS.shipCenterWorld(st.ship);
      if (center) {
        var BlockPos = Java.loadClass('net.minecraft.core.BlockPos');
        var centerPos = new BlockPos(Math.floor(center.x), Math.floor(center.y), Math.floor(center.z));
        if (!st.level.isLoaded(centerPos)) {
          // Ship is unloaded, remove it
          KubeVS.removeShip(st.level, st.ship);
          delete SHIPS_TRACK[id];
          removed++;
        }
      }
    } catch (e) {
      // Ship probably doesn't exist anymore
      delete SHIPS_TRACK[id];
      removed++;
    }
  });
  
  return removed;
}

// ---------- pirate detection ----------
function _countPiratesOnShip(level, ship) {
  try {
    var pirates = KubeVS.entitiesInShip(level, ship, 'pirates:pirate');
    return pirates ? pirates.length : 0;
  } catch (e) {
    logDetail('countPiratesOnShip error: '+e);
    return 0;
  }
}

// ---------- decay system ----------
function _initDecay(st) {
  if (st.decaying) return; // Already decaying
  
  st.decaying = true;
  st.decayStartTime = Date.now();
  st.decayBounds = _findActualShipBounds(st.ship, st.level);
  st.decayCurrentY = st.decayBounds.minY;
  st.decayLayerPositions = []; // Will hold shuffled positions for current layer
  st.decayLayerIndex = 0; // Current position within the layer
  st.decayLastBlockTime = 0; // Track when last block was processed
  st.decayProgress = 0;
  st.lastSavedCenter = null; // Track center position for final barrel collection
  st.decayChunkCount = 0; // Track number of chunks processed for acceleration
  
  // Initialize continuous sail decay
  st.sailDecayLastTime = 0; // Track timing for sail decay
  st.sailDecayActive = true; // Enable continuous sail decay
  
  logTrack('initDecay ship='+st.id+' bounds=('+st.decayBounds.minX+','+st.decayBounds.minY+','+st.decayBounds.minZ+') to ('+st.decayBounds.maxX+','+st.decayBounds.maxY+','+st.decayBounds.maxZ+')');
}

function _findActualShipBounds(ship, level) {
  try {
    var aabb = KubeVS.shipAABB ? KubeVS.shipAABB(ship) : null;
    if (aabb) {
      return {
        minX: Math.floor(aabb.minX),
        minY: Math.floor(aabb.minY),
        minZ: Math.floor(aabb.minZ),
        maxX: Math.floor(aabb.maxX),
        maxY: Math.floor(aabb.maxY),
        maxZ: Math.floor(aabb.maxZ)
      };
    }
  } catch (e) {
    logDetail('findActualShipBounds error: '+e);
  }
  
  // Fallback to default bounds
  var CFG = global.Ships_CFG;
  var center = KubeVS.shipCenterWorld(ship);
  var cx = center ? Math.floor(center.x) : 0;
  var cy = center ? Math.floor(center.y) : 64;
  var cz = center ? Math.floor(center.z) : 0;
  var r = CFG.DECAY_DEFAULT_BOUNDS;
  var h = CFG.DECAY_DEFAULT_HEIGHT;
  
  return {
    minX: cx - r, maxX: cx + r,
    minY: cy - h, maxY: cy + h,
    minZ: cz - r, maxZ: cz + r
  };
}

function _isSailBlock(blockState) {
  try {
    var block = blockState.getBlock();
    
    // Check ITEM tag using the correct method
    if (typeof block.asItem === 'function') {
      var item = block.asItem();
      if (typeof item.getDefaultInstance === 'function') {
        var itemStack = item.getDefaultInstance();
        
        // Try KubeJS hasTag method first
        if (typeof itemStack.hasTag === 'function') {
          var tagVariants = ['minecraft:sail_togglers', 'sail_togglers'];
          for (var i = 0; i < tagVariants.length; i++) {
            try {
              if (itemStack.hasTag(tagVariants[i])) {
                return true;
              }
            } catch (tagError) {
              // Continue to next variant
            }
          }
        }
        
        // Fallback to itemStack.is() method
        if (typeof itemStack.is === 'function') {
          var tagVariants = ['minecraft:sail_togglers', 'sail_togglers'];
          for (var i = 0; i < tagVariants.length; i++) {
            try {
              if (itemStack.is(tagVariants[i])) {
                return true;
              }
            } catch (tagError) {
              // Continue to next variant
            }
          }
        }
      }
    }
  } catch (e) {
    // Silent fail - not a sail block
  }
  
  return false;
}

function _processDecay(st) {
  if (!st.decaying || !st.ship || !st.level) return false;
  
  var bounds = st.decayBounds;
  var currentTime = Date.now();
  var CFG = global.Ships_CFG;
  
  // Calculate timing based on progress
  var progress = st.decayChunkCount / CFG.DECAY_ACCELERATION;
  if (progress > 1) progress = 1;
  var currentDelay = CFG.DECAY_START_TICKS - (CFG.DECAY_START_TICKS - CFG.DECAY_END_TICKS) * progress;
  var delayMs = currentDelay * 50; // Convert ticks to milliseconds
  
  if (currentTime - st.decayLastBlockTime < delayMs) {
    return false; // Not time yet
  }
  
  // Save current ship center position for final barrel collection
  try {
    if (global.KubeVS && global.KubeVS.shipCenterWorld && st.ship) {
      var currentCenter = global.KubeVS.shipCenterWorld(st.ship);
      if (currentCenter) {
        st.lastSavedCenter = {
          x: currentCenter.x,
          y: currentCenter.y,
          z: currentCenter.z
        };
      }
    }
  } catch (centerErr) {
    logDetail('processDecay ship='+st.id+' failed to save center position: '+centerErr);
  }
  
  // Check if we need to trigger barrel collection (every 20 chunks)
  var startSize = CFG.DECAY_FLOODFILL_START;
  var endSize = CFG.DECAY_FLOODFILL_END;
  var floodFillSize = Math.floor(startSize + (endSize - startSize) * progress);
  
  // Every 20 chunks, create barrel ships from nearby dropped items using last saved center
  if (st.decayChunkCount > 0 && st.decayChunkCount % 20 === 0 && st.lastSavedCenter) {
    logTrack('processDecay ship='+st.id+' chunk '+st.decayChunkCount+' triggering periodic barrel collection');
    _createFinalBarrelCollection(st.level, st.lastSavedCenter.x, st.lastSavedCenter.y, st.lastSavedCenter.z, st.id + '_chunk' + st.decayChunkCount);
  }
  
  // Process current layer
  if (st.decayLayerPositions.length === 0) {
    // Generate new layer
    if (st.decayCurrentY > bounds.maxY) {
      // Finished all layers
      _completeDecay(st);
      return true;
    }
    
    // Generate positions for current Y layer
    for (var x = bounds.minX; x <= bounds.maxX; x++) {
      for (var z = bounds.minZ; z <= bounds.maxZ; z++) {
        st.decayLayerPositions.push({x: x, y: st.decayCurrentY, z: z});
      }
    }
    
    // Shuffle positions for random decay within layer
    for (var i = st.decayLayerPositions.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var temp = st.decayLayerPositions[i];
      st.decayLayerPositions[i] = st.decayLayerPositions[j];
      st.decayLayerPositions[j] = temp;
    }
    
    st.decayLayerIndex = 0;
    st.decayCurrentY++;
  }
  
  // Process blocks in current layer using floodfill
  if (st.decayLayerIndex < st.decayLayerPositions.length) {
    var pos = st.decayLayerPositions[st.decayLayerIndex];
    st.decayLayerIndex++;
    
    var blocksProcessed = _processBlockClump(st.level, pos.x, pos.y, pos.z, st.ship, floodFillSize);
    
    if (blocksProcessed > 0) {
      st.decayProgress += blocksProcessed;
      st.decayLastBlockTime = currentTime;
      st.decayChunkCount++;
      
      // Play sound effect
      try {
        st.level.playSound(null, pos.x, pos.y, pos.z, 'minecraft:entity.zombie.attack_wooden_door', 'blocks', 0.3, 0.1 + Math.random() * 0.3);
      } catch (soundErr) {
        // Sound failed, continue
      }
    }
    
    // If we've processed all positions in this layer, move to next layer
    if (st.decayLayerIndex >= st.decayLayerPositions.length) {
      st.decayLayerPositions = [];
    }
  }
  
  return false;
}

function _processBlockClump(level, startX, startY, startZ, ship, maxBlocks) {
  var processed = 0;
  var toProcess = [{x: startX, y: startY, z: startZ}];
  var visited = new Set();
  
  while (toProcess.length > 0 && processed < maxBlocks) {
    var pos = toProcess.shift();
    var key = pos.x + ',' + pos.y + ',' + pos.z;
    
    if (visited.has(key)) continue;
    visited.add(key);
    
    var BlockPos = Java.loadClass('net.minecraft.core.BlockPos');
    var blockPos = new BlockPos(pos.x, pos.y, pos.z);
    var blockState = level.getBlockState(blockPos);
    
    if (blockState.isAir()) continue;
    
    // Convert to falling block
    try {
      var FallingBlockEntity = Java.loadClass('net.minecraft.world.entity.item.FallingBlockEntity');
      var fallingBlock = FallingBlockEntity.fall(level, blockPos, blockState);
      if (fallingBlock) {
        // Offset slightly to avoid collision
        fallingBlock.setPos(pos.x + 0.5, pos.y - 0.5, pos.z + 0.5);
        level.addFreshEntity(fallingBlock);
        
        // Remove original block
        level.setBlock(blockPos, level.getBlockState(new BlockPos(0, -64, 0)).getBlock().defaultBlockState(), 3);
        processed++;
      }
    } catch (e) {
      logDetail('processBlockClump error at ('+pos.x+','+pos.y+','+pos.z+'): '+e);
    }
    
    // Add adjacent blocks (26-directional floodfill)
    for (var dx = -1; dx <= 1; dx++) {
      for (var dy = -1; dy <= 1; dy++) {
        for (var dz = -1; dz <= 1; dz++) {
          if (dx === 0 && dy === 0 && dz === 0) continue;
          var newPos = {x: pos.x + dx, y: pos.y + dy, z: pos.z + dz};
          var newKey = newPos.x + ',' + newPos.y + ',' + newPos.z;
          if (!visited.has(newKey)) {
            toProcess.push(newPos);
          }
        }
      }
    }
  }
  
  return processed;
}

function _processSailDecay(st) {
  if (!st.sailDecayActive || !st.ship || !st.level) return;
  
  var currentTime = Date.now();
  var sailDecayInterval = 1000; // 1 second
  
  if (currentTime - st.sailDecayLastTime < sailDecayInterval) {
    return; // Not time yet
  }
  
  st.sailDecayLastTime = currentTime;
  
  // Find a random sail block and decay it
  var bounds = st.decayBounds;
  var attempts = 0;
  var maxAttempts = 50;
  
  while (attempts < maxAttempts) {
    var x = bounds.minX + Math.floor(Math.random() * (bounds.maxX - bounds.minX + 1));
    var y = bounds.minY + Math.floor(Math.random() * (bounds.maxY - bounds.minY + 1));
    var z = bounds.minZ + Math.floor(Math.random() * (bounds.maxZ - bounds.minZ + 1));
    
    var BlockPos = Java.loadClass('net.minecraft.core.BlockPos');
    var blockPos = new BlockPos(x, y, z);
    var blockState = st.level.getBlockState(blockPos);
    
    if (!blockState.isAir() && _isSailBlock(blockState)) {
      // Found a sail block, start floodfill decay
      var CFG = global.Ships_CFG;
      var processed = _floodFillSailDecay(st.level, x, y, z, st.ship, CFG.SAIL_FLOODFILL_SIZE);
      
      if (processed > 0) {
        // Play sail decay sound
        try {
          st.level.playSound(null, x, y, z, 'supplementaries:block.sack.break', 'blocks', 0.5, 0.8 + Math.random() * 0.4);
        } catch (soundErr) {
          // Sound failed, continue
        }
      }
      break;
    }
    attempts++;
  }
}

function _floodFillSailDecay(level, startX, startY, startZ, ship, maxBlocks) {
  var processed = 0;
  var toProcess = [{x: startX, y: startY, z: startZ}];
  var visited = new Set();
  
  while (toProcess.length > 0 && processed < maxBlocks) {
    var pos = toProcess.shift();
    var key = pos.x + ',' + pos.y + ',' + pos.z;
    
    if (visited.has(key)) continue;
    visited.add(key);
    
    var BlockPos = Java.loadClass('net.minecraft.core.BlockPos');
    var blockPos = new BlockPos(pos.x, pos.y, pos.z);
    var blockState = level.getBlockState(blockPos);
    
    if (blockState.isAir() || !_isSailBlock(blockState)) continue;
    
    // Convert sail block to falling block
    try {
      var FallingBlockEntity = Java.loadClass('net.minecraft.world.entity.item.FallingBlockEntity');
      var fallingBlock = FallingBlockEntity.fall(level, blockPos, blockState);
      if (fallingBlock) {
        fallingBlock.setPos(pos.x + 0.5, pos.y - 0.5, pos.z + 0.5);
        level.addFreshEntity(fallingBlock);
        
        // Remove original block
        level.setBlock(blockPos, level.getBlockState(new BlockPos(0, -64, 0)).getBlock().defaultBlockState(), 3);
        processed++;
      }
    } catch (e) {
      logDetail('floodFillSailDecay error at ('+pos.x+','+pos.y+','+pos.z+'): '+e);
    }
    
    // Add adjacent blocks (26-directional floodfill)
    for (var dx = -1; dx <= 1; dx++) {
      for (var dy = -1; dy <= 1; dy++) {
        for (var dz = -1; dz <= 1; dz++) {
          if (dx === 0 && dy === 0 && dz === 0) continue;
          var newPos = {x: pos.x + dx, y: pos.y + dy, z: pos.z + dz};
          var newKey = newPos.x + ',' + newPos.y + ',' + newPos.z;
          if (!visited.has(newKey)) {
            toProcess.push(newPos);
          }
        }
      }
    }
  }
  
  return processed;
}

function _completeDecay(st) {
  if (!st) return;
  
  st.decaying = false;
  st.decayCompleted = true;
  
  logTrack('completeDecay ship='+st.id+' finished, processed '+st.decayProgress+' blocks in '+st.decayChunkCount+' chunks');
  
  // Do final barrel collection using last saved center position
  if (st.lastSavedCenter && st.level) {
    logTrack('completeDecay ship='+st.id+' performing final barrel collection at last saved center ('+st.lastSavedCenter.x.toFixed(1)+','+st.lastSavedCenter.y.toFixed(1)+','+st.lastSavedCenter.z.toFixed(1)+')');
    _createFinalBarrelCollection(st.level, st.lastSavedCenter.x, st.lastSavedCenter.y, st.lastSavedCenter.z, st.id);
  } else {
    logTrack('completeDecay ship='+st.id+' no saved center position available for final barrel collection');
  }
  
  var server = st.level ? st.level.server : null;
  if (server) {
    Ships_broadcast(server, '§8[Ships] Ship '+st.id+' has completely collapsed into the depths... §6Salvage barrel ships are floating away!');
  }
}

// ---------- barrel system ----------
function _createFinalBarrelCollection(level, centerX, centerY, centerZ, shipId) {
  if (!level) return;
  
  logTrack('createFinalBarrelCollection ship='+shipId+' collecting items in 100x100x100 area around ('+centerX.toFixed(1)+','+centerY.toFixed(1)+','+centerZ.toFixed(1)+')');
  
  // Collect items in 100x100x100 area (50 block radius)
  var collectRadius = 50;
  var minX = centerX - collectRadius;
  var minY = Math.max(level.getMinBuildHeight(), centerY - collectRadius);
  var minZ = centerZ - collectRadius;
  var maxX = centerX + collectRadius;
  var maxY = Math.min(level.getMaxBuildHeight(), centerY + collectRadius);
  var maxZ = centerZ + collectRadius;
  
  var AABB = Java.loadClass('net.minecraft.world.phys.AABB');
  var collectionAABB = new AABB(minX, minY, minZ, maxX, maxY, maxZ);
  var ItemEntityClass = Java.loadClass('net.minecraft.world.entity.item.ItemEntity');
  var itemEntities = level.getEntitiesOfClass(ItemEntityClass, collectionAABB);
  
  if (!itemEntities || itemEntities.size() === 0) {
    logTrack('createFinalBarrelCollection ship='+shipId+' no items found in collection area');
    return;
  }
  
  logTrack('createFinalBarrelCollection ship='+shipId+' found '+itemEntities.size()+' dropped items');
  
  // Collect all items
  var allItems = [];
  var iterator = itemEntities.iterator();
  while (iterator.hasNext()) {
    var itemEntity = iterator.next();
    var itemStack = itemEntity.getItem();
    if (itemStack && !itemStack.isEmpty()) {
      allItems.push(itemStack.copy());
      itemEntity.discard(); // Remove the item entity
    }
  }
  
  if (allItems.length === 0) {
    logTrack('createFinalBarrelCollection ship='+shipId+' no valid items collected');
    return;
  }
  
  // Create barrel ships with collected items
  var itemsPerBarrel = 27; // Standard barrel capacity
  var barrelCount = 0;
  var spreadRadius = 25; // Spread barrels over 50x50 area
  var startIndex = 0;
  
  while (startIndex < allItems.length) {
    var barrelItems = allItems.slice(startIndex, startIndex + itemsPerBarrel);
    var barrelPos = _findSpreadPosition(level, centerX, centerY, centerZ, barrelCount, spreadRadius);
    _createBarrelShip(level, barrelPos.x, barrelPos.y, barrelPos.z, barrelItems, shipId + '_final_' + barrelCount);
    barrelCount++;
    startIndex += itemsPerBarrel;
  }
  
  logTrack('createFinalBarrelCollection ship='+shipId+' created '+barrelCount+' final barrel ships with '+allItems.length+' total items');
}

function _findSpreadPosition(level, centerX, centerY, centerZ, barrelIndex, spreadRadius) {
  // Create a more spread out distribution using a spiral pattern
  var angle = barrelIndex * 2.4; // Golden angle for even distribution
  var distance = Math.sqrt(barrelIndex) * 3; // Gradually increase distance
  
  // Cap distance to stay within spread radius
  if (distance > spreadRadius) {
    distance = spreadRadius * (0.5 + 0.5 * Math.random()); // Random within outer area
  }
  
  var offsetX = Math.cos(angle) * distance;
  var offsetZ = Math.sin(angle) * distance;
  
  // Find water surface and place barrels underwater (below y=63)
  var targetX = Math.floor(centerX + offsetX);
  var targetZ = Math.floor(centerZ + offsetZ);
  
  // Start from y=63 and go down to find water
  var targetY = Math.min(63, centerY);
  var foundWater = false;
  
  // Look for water blocks, going down from y=63
  for (var y = targetY; y >= level.getMinBuildHeight() + 5; y--) {
    var BlockPos = Java.loadClass('net.minecraft.core.BlockPos');
    var checkPos = new BlockPos(targetX, y, targetZ);
    var blockState = level.getBlockState(checkPos);
    
    // Check if block is water (directly check block ID)
    var blockId = blockState.getBlock().getId();
    if (blockId === 'minecraft:water' || blockId === 'minecraft:flowing_water') {
      // Found water, place barrel 2-5 blocks underwater
      var underwaterDepth = 2 + Math.floor(Math.random() * 4); // 2-5 blocks deep
      targetY = y - underwaterDepth;
      foundWater = true;
      break;
    }
  }
  
  // If no water found, default to a safe underwater position
  if (!foundWater) {
    targetY = Math.min(50, centerY - 10); // Default deep position
  }
  
  return {
    x: targetX,
    y: targetY,
    z: targetZ
  };
}

function _createBarrelShip(level, x, y, z, items, barrelNumber) {
  try {
    var BlockPos = Java.loadClass('net.minecraft.core.BlockPos');
    var Blocks = Java.loadClass('net.minecraft.world.level.block.Blocks');
    
    var barrelPos = new BlockPos(x, y, z);
    var barrelState = Blocks.BARREL.defaultBlockState();
    
    // Apply random rotation to the barrel blockstate
    try {
      // Barrels can face 6 directions (up, down, north, south, east, west)
      var Direction = Java.loadClass('net.minecraft.core.Direction');
      var directions = [
        Direction.UP,
        Direction.DOWN, 
        Direction.NORTH,
        Direction.SOUTH,
        Direction.EAST,
        Direction.WEST
      ];
      
      var randomDirection = directions[Math.floor(Math.random() * directions.length)];
      var BlockStateProperties = Java.loadClass('net.minecraft.world.level.block.state.properties.BlockStateProperties');
      
      // Set the FACING property to random direction
      if (barrelState.hasProperty && barrelState.hasProperty(BlockStateProperties.FACING)) {
        barrelState = barrelState.setValue(BlockStateProperties.FACING, randomDirection);
      }
    } catch (rotationError) {
      // Use default orientation
    }
    
    // First, place the barrel block with rotation
    level.setBlock(barrelPos, barrelState, 3);
    
    // Fill the barrel with items
    var blockEntity = level.getBlockEntity(barrelPos);
    if (blockEntity && blockEntity.getContainerSize) {
      for (var i = 0; i < items.length && i < blockEntity.getContainerSize(); i++) {
        blockEntity.setItem(i, items[i]);
      }
      blockEntity.setChanged();
    }
    
    // Attempt to convert the barrel block into a Valkyrien Skies ship
    try {
      if (global.KubeVS && global.KubeVS.createShip) {
        var ship = global.KubeVS.createShip(level, barrelPos);
        if (ship) {
          logTrack('createBarrelShip SUCCESS: Created VS ship for barrel #'+barrelNumber+' at ('+x+','+y+','+z+') ship='+ship);
          
          // Track barrel for cleanup
          var barrelId = 'barrel_' + barrelNumber + '_' + Date.now();
          BARREL_TRACK[barrelId] = {
            ship: ship,
            level: level,
            pos: { x: x, y: y, z: z },
            createTime: Date.now(),
            barrelNumber: barrelNumber
          };
        }
      }
    } catch (shipError) {
      logDetail('createBarrelShip ship creation failed for barrel #'+barrelNumber+': '+shipError);
    }
    
  } catch (e) {
    logDetail('createBarrelShip error: '+e);
  }
}

// ---------- barrel cleanup ----------
function _processBarrelCleanup() {
  var CFG = global.Ships_CFG;
  if (!CFG || CFG.BARREL_DESPAWN_MINUTES <= 0) return; // Cleanup disabled
  
  var currentTime = Date.now();
  var despawnTimeMs = CFG.BARREL_DESPAWN_MINUTES * 60 * 1000; // Convert to milliseconds
  var barrelIds = Object.keys(BARREL_TRACK);
  var removedCount = 0;
  
  for (var i = 0; i < barrelIds.length; i++) {
    var barrelId = barrelIds[i];
    var barrel = BARREL_TRACK[barrelId];
    
    if (!barrel) continue;
    
    var age = currentTime - barrel.createTime;
    if (age >= despawnTimeMs) {
      // Barrel is old enough to despawn
      try {
        if (barrel.ship && global.KubeVS && global.KubeVS.removeShip) {
          var removed = global.KubeVS.removeShip(barrel.ship);
          if (removed) {
            removedCount++;
          }
        }
      } catch (removeErr) {
        // Continue cleanup
      }
      
      // Remove from tracking regardless of success
      delete BARREL_TRACK[barrelId];
    }
  }
  
  if (removedCount > 0) {
    logTrack('processBarrelCleanup removed ' + removedCount + ' expired barrels (age limit: ' + CFG.BARREL_DESPAWN_MINUTES + ' minutes)');
  }
}

function _cleanupAllBarrels() {
  var barrelIds = Object.keys(BARREL_TRACK);
  var removedCount = 0;
  
  logTrack('cleanupAllBarrels removing ' + barrelIds.length + ' tracked barrels');
  
  for (var i = 0; i < barrelIds.length; i++) {
    var barrelId = barrelIds[i];
    var barrel = BARREL_TRACK[barrelId];
    
    if (!barrel) continue;
    
    try {
      if (barrel.ship && global.KubeVS && global.KubeVS.removeShip) {
        var removed = global.KubeVS.removeShip(barrel.ship);
        if (removed) {
          removedCount++;
        }
      }
    } catch (removeErr) {
      // Continue cleanup
    }
    
    delete BARREL_TRACK[barrelId];
  }
  
  logTrack('cleanupAllBarrels removed ' + removedCount + ' barrels');
}

// ---------- test functions ----------
function _testCreateBarrelShipsAt(level, x, y, z) {
  if (!level) return;
  
  var collectRadius = 25; // 50x50x50 area (25 blocks in each direction)
  
  logTrack('testCreateBarrelShipsAt collecting items in 50x50x50 area around test pos ('+x+','+y+','+z+')');
  
  // Create AABB for item collection around the test position
  var minX = x - collectRadius;
  var minY = Math.max(level.getMinBuildHeight(), y - collectRadius);
  var minZ = z - collectRadius;
  var maxX = x + collectRadius;
  var maxY = Math.min(level.getMaxBuildHeight(), y + collectRadius);
  var maxZ = z + collectRadius;
  
  var AABB = Java.loadClass('net.minecraft.world.phys.AABB');
  var collectionAABB = new AABB(minX, minY, minZ, maxX, maxY, maxZ);
  
  // Find all item entities in the area
  var ItemEntityClass = Java.loadClass('net.minecraft.world.entity.item.ItemEntity');
  var itemEntities = level.getEntitiesOfClass(ItemEntityClass, collectionAABB);
  
  if (!itemEntities || itemEntities.size() === 0) {
    logTrack('testCreateBarrelShipsAt no items found in test area - creating test items');
    
    // Create some test items
    var Items = Java.loadClass('net.minecraft.world.item.Items');
    var ItemStack = Java.loadClass('net.minecraft.world.item.ItemStack');
    var ItemEntity = Java.loadClass('net.minecraft.world.entity.item.ItemEntity');
    
    var testItems = [
      new ItemStack(Items.DIAMOND, 5),
      new ItemStack(Items.GOLD_INGOT, 10),
      new ItemStack(Items.IRON_INGOT, 20),
      new ItemStack(Items.COAL, 32)
    ];
    
    for (var i = 0; i < testItems.length; i++) {
      var itemEntity = new ItemEntity(level, x + Math.random() * 10 - 5, y + 2, z + Math.random() * 10 - 5, testItems[i]);
      level.addFreshEntity(itemEntity);
    }
    
    logTrack('testCreateBarrelShipsAt created '+testItems.length+' test items');
    return;
  }
  
  logTrack('testCreateBarrelShipsAt found '+itemEntities.size()+' items, creating test barrel ships');
  
  // Use the barrel collection system
  _createFinalBarrelCollection(level, x, y, z, 'test');
}

// ---------- utility functions ----------
function Ships_broadcast(server, message) {
  try {
    server.tell(message);
  } catch (e) {
    // Fallback
    console.log(message);
  }
}

// expose (Rhino-safe; no globalThis)
global.SHIPS_trackAt  = SHIPS_trackAt;
global.SHIPS_TRACK    = SHIPS_TRACK;
global.BARREL_TRACK   = BARREL_TRACK;
global.TRACK_CFG      = TRACK_CFG;
global.TRACK_DBG      = TRACK_DBG;
global._processBarrelCleanup = _processBarrelCleanup;
global._cleanupAllBarrels = _cleanupAllBarrels;
global._testCreateBarrelShipsAt = _testCreateBarrelShipsAt;

// periodic unloaded-ship pruning every ~1 minute (1200 ticks)
ServerEvents.tick(function(event){
  var server = event.server;
  var t = (global.Ships_tickCounter ? global.Ships_tickCounter() : 0) | 0;
  // Use the shared counter so it stays consistent
  if (t % (60*20) !== 0) return;
  try {
    var n = SHIPS_removeOldShips();
    if (n>0) dbg(server, 'pruned '+n+' unloaded ship(s)');
  } catch(_){ }
  
  // Process barrel cleanup every minute
  try {
    _processBarrelCleanup();
  } catch(barrelErr) {
    dbg(server, 'barrel cleanup error: '+barrelErr);
  }
});

// dedicated decay processing loop - runs every tick for responsive decay
ServerEvents.tick(function(event){
  var server = event.server;
  var t = (global.Ships_tickCounter ? global.Ships_tickCounter() : 0) | 0;
  
  try {
    var keys = Object.keys(SHIPS_TRACK || {});
    for (var i = 0; i < keys.length; i++) {
      var id = keys[i];
      var st = SHIPS_TRACK[id];
      if (!st || !st.decaying || !st.ship || !st.level) continue;
      
      // Process both main decay and sail decay
      var shouldRemove = _processDecay(st);
      
      // Initialize sail decay for existing ships
      if (st.sailDecayActive === undefined) {
        st.sailDecayActive = true;
        st.sailDecayLastTime = 0;
      }
      
      if (st.sailDecayActive) {
        _processSailDecay(st); // Run continuous sail decay in parallel
      }
      
      if (shouldRemove) {
        dbg(server, 'decay completed for ship '+id+', removing');
        try { 
          var ok = !!KubeVS.removeShip(st.level, st.ship); 
          if (ok) {
            delete SHIPS_TRACK[id];
          }
        } catch(e) { 
          logDetail('decay removal error: '+e);
        }
      }
    }
  } catch(e) {
    logDetail('decay loop error: '+e);
  }
});
