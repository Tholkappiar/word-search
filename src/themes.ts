// Word-search categories of very common everyday words: uppercase A-Z, 3 or 4
// letters. Early levels hide only 3-letter words, later ones 4-letter words, so
// each category needs at least 4 of each length (see LEVELS in game.ts).
// No word may contain another word of its category (forwards or backwards), or
// typing the shorter one would do nothing. The page shows "Find 2 <many>".
export const THEMES = [
  { name: "Animals", one: "animal", many: "animals",
    words: ["CAT", "DOG", "PIG", "COW", "HEN", "FOX", "BEE", "ANT", "OWL", "BAT", "RAT", "LION", "BEAR", "WOLF", "DUCK", "GOAT", "FROG", "FISH", "DEER", "CRAB", "SEAL"] },
  { name: "Food", one: "food", many: "foods",
    words: ["EGG", "PIE", "TEA", "JAM", "HAM", "BUN", "NUT", "FIG", "CAKE", "RICE", "SOUP", "MILK", "MEAT", "CORN", "BEAN", "PEAR", "PLUM", "KIWI", "LIME"] },
  { name: "Body", one: "body part", many: "body parts",
    words: ["ARM", "LEG", "EYE", "EAR", "LIP", "TOE", "HIP", "JAW", "HAND", "FOOT", "HEAD", "NOSE", "KNEE", "NECK", "CHIN", "BACK", "HAIR", "SKIN"] },
  { name: "Home", one: "thing at home", many: "things at home",
    words: ["BED", "CUP", "MAT", "FAN", "POT", "PAN", "RUG", "BOX", "KEY", "DOOR", "LAMP", "SOFA", "BOOK", "DESK", "SINK", "FORK", "BOWL", "BATH"] },
  { name: "Wear", one: "thing to wear", many: "things to wear",
    words: ["HAT", "CAP", "TIE", "WIG", "SOCK", "SHOE", "COAT", "BELT", "VEST", "BOOT", "GOWN", "ROBE", "MASK", "RING"] },
  { name: "Nature", one: "thing in nature", many: "things in nature",
    words: ["SUN", "SKY", "SEA", "ICE", "MUD", "FOG", "TREE", "RAIN", "SNOW", "WIND", "LEAF", "ROCK", "STAR", "MOON", "LAKE", "HILL"] },
  { name: "Vehicles", one: "vehicle", many: "vehicles",
    words: ["CAR", "BUS", "VAN", "JET", "CAB", "BIKE", "BOAT", "SHIP", "TAXI", "JEEP", "TRAM", "SLED", "RAFT"] }
] as const;
