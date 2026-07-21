export const ACTIONS = [
  // 🏆 Gains
  { action: '+1_win',   label: '+1 Win',   category: '🏆 Gains' },
  { action: '+5_wins',  label: '+5 Wins',  category: '🏆 Gains' },
  { action: '+25_wins', label: '+25 Wins', category: '🏆 Gains' },
  { action: '+50_wins', label: '+50 Wins', category: '🏆 Gains' },

  // 💀 Malus
  { action: '-1_win',   label: '-1 Win',   category: '💀 Malus' },
  { action: '-5_wins',  label: '-5 Wins',  category: '💀 Malus' },
  { action: '-10_wins', label: '-10 Wins', category: '💀 Malus' },
  { action: '-50_wins', label: '-50 Wins', category: '💀 Malus' },

  // 🔄 Reset
  { action: 'reset_win', label: 'Reset Win', category: '🔄 Reset' },

  // ⬆️ Hauteur
  { action: '+5m',   label: '+5m',   category: '⬆️ Hauteur' },
  { action: '+50m',  label: '+50m',  category: '⬆️ Hauteur' },
  { action: '+150m', label: '+150m', category: '⬆️ Hauteur' },
  { action: '+500m', label: '+500m', category: '⬆️ Hauteur' },

  // ⬇️ Hauteur
  { action: '-5m',   label: '-5m',   category: '⬇️ Hauteur' },
  { action: '-50m',  label: '-50m',  category: '⬇️ Hauteur' },
  { action: '-150m', label: '-150m', category: '⬇️ Hauteur' },
  { action: '-500m', label: '-500m', category: '⬇️ Hauteur' },

  // 📍 Téléportation
  { action: 'tp_haut', label: 'TP Tout en haut', category: '📍 Téléportation' },
  { action: 'tp_bas',  label: 'TP Tout en bas',  category: '📍 Téléportation' },

  // 🔒 Prison
  { action: 'prison',  label: 'Prison (tous)',  category: '🔒 Prison' },
  { action: 'liberer', label: 'Libérer (tous)', category: '🔒 Prison' },

  // ⚡ Boosts
  { action: 'boost',       label: 'Boost Multiplicateur', category: '⚡ Boosts' },
  { action: 'roue_boost',  label: 'Roue Multiplicateur',  category: '⚡ Boosts' },
  { action: 'roue_action', label: "Roue d'Actions",       category: '⚡ Boosts' },
];
