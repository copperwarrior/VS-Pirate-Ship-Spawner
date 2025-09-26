// ships/50_commands.js
// /ships check and /ships force

var Commands = Java.loadClass('net.minecraft.commands.Commands');
var LiteralArgumentBuilder = Java.loadClass('com.mojang.brigadier.builder.LiteralArgumentBuilder');

ServerEvents.commandRegistry(event=>{
  event.register(
    Commands.literal('ships')
      .requires(cs => cs.hasPermission(2))
      .then(
        Commands.literal('check')
          .executes(ctx => {
            try{ global.Ships_runCycle(ctx.source.server, { verbose:true }); }catch(e){}
            return 1;
          })
      )
      .then(
        Commands.literal('force')
          .executes(ctx => {
            try{ global.Ships_runCycle(ctx.source.server, { triesPerPlayerOverride: 12, forceChance: 1.0, verbose:true }); }catch(e){}
            return 1;
          })
      )
  );
});
