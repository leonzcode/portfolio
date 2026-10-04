/* ---------------------------------------------------------------------------
   Leoncraft 2 - the line of text over the hotbar ("You can sleep only at
   night and during thunderstorms", "Respawn point set"), and the screen
   going dark while you sleep. Drawn as a GUI overlay (ui/gui.js) in the
   game's font: white with a shadow, fading out over its last second, as the
   game's action bar does. It shows for 3 seconds (60 ticks) like the game's.
--------------------------------------------------------------------------- */
export class Messages {
  constructor(gui) {
    this.gui = gui;
    this.text = ''; this.left = 0;
    this.dark = 0;                 // 0..1 how dark the screen is (sleeping)
    this.flash = 0;                // lightning lighting up the screen
    this.overlay = { draw: g => this.draw(g), animates: false };
    if (gui && gui.overlays) gui.overlays.push(this.overlay);
  }
  dispose() {
    if (this.gui && this.gui.overlays) { const i = this.gui.overlays.indexOf(this.overlay); if (i >= 0) this.gui.overlays.splice(i, 1); }
  }
  show(text, ticks) {
    this.text = text; this.left = ticks || 60;
    this.overlay.animates = true;
    if (this.gui && this.gui.markDirty) this.gui.markDirty();
  }
  tick() {
    if (this.left > 0) this.left--;
    this.overlay.animates = this.left > 0 || this.dark > 0;
  }
  draw(g) {
    if (this.dark > 0) {
      const ctx = g.ctx;
      ctx.save();
      ctx.globalAlpha = Math.min(1, this.dark);
      ctx.fillStyle = '#100c18';
      ctx.fillRect(0, 0, g.width, g.height);
      ctx.restore();
    }
    if (this.left <= 0 || !this.text || g.hideHud) return;
    const ctx = g.ctx;
    ctx.save();
    ctx.globalAlpha = Math.min(1, this.left / 20);
    g.centered(this.text, Math.floor(g.width / 2), g.height - 59, 0xFFFFFF, true);
    ctx.restore();
  }
}
