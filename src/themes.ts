// Word-search categories. Keep words short, common and easy to recognise:
// uppercase A-Z, 4-8 letters (3-letter words appear in random filler too often).
// Each category needs well over WORDS_PER_ROUND words so rounds vary.
// No word may contain another word of its category (forwards or backwards), or
// typing the shorter one would do nothing. The page shows "Find 10 <label> · Round N".
export const THEMES = [
  { name: "Animals", label: "animals", words: ["LION", "TIGER", "BEAR", "WOLF", "DUCK", "HORSE", "SHEEP", "GOAT", "MOUSE", "RABBIT", "MONKEY", "ZEBRA", "PANDA", "FROG", "CAMEL", "SNAKE", "EAGLE", "SHARK"] },
  { name: "Fruits", label: "fruits", words: ["APPLE", "MANGO", "GRAPE", "LEMON", "PEACH", "PEAR", "PLUM", "KIWI", "BANANA", "ORANGE", "CHERRY", "MELON", "LIME", "GUAVA", "PAPAYA", "COCONUT"] },
  { name: "Colors", label: "colors", words: ["BLUE", "PINK", "GREEN", "BLACK", "WHITE", "BROWN", "GREY", "GOLD", "PURPLE", "ORANGE", "YELLOW", "SILVER", "CREAM", "NAVY", "VIOLET", "MAROON"] },
  { name: "Food", label: "foods", words: ["PIZZA", "BREAD", "RICE", "CAKE", "SOUP", "SALAD", "PASTA", "CHEESE", "BURGER", "COOKIE", "HONEY", "TOAST", "NOODLE", "DONUT", "CANDY", "BUTTER"] },
  { name: "Body Parts", label: "body parts", words: ["HAND", "FOOT", "HEAD", "NOSE", "MOUTH", "KNEE", "NECK", "ELBOW", "THUMB", "TOOTH", "HEART", "CHIN", "BACK", "FINGER", "TONGUE", "CHEEK"] },
  { name: "Sports", label: "sports", words: ["GOLF", "TENNIS", "SOCCER", "RUGBY", "HOCKEY", "BOXING", "CHESS", "KARATE", "CRICKET", "SKIING", "SURFING", "DIVING", "ROWING", "DARTS", "JUDO", "POLO"] },
  { name: "Weather", label: "weather words", words: ["SNOW", "WIND", "STORM", "CLOUD", "SUNNY", "FOGGY", "HAIL", "FROST", "THUNDER", "RAINBOW", "MIST", "HUMID", "BREEZE", "HEAT", "COLD"] },
  { name: "Home", label: "things at home", words: ["CHAIR", "TABLE", "SOFA", "LAMP", "DOOR", "CLOCK", "BOOK", "SPOON", "PLATE", "KNIFE", "FORK", "SHELF", "BRUSH", "PILLOW", "MIRROR", "WINDOW", "CARPET"] },
  { name: "Clothes", label: "clothes", words: ["SHIRT", "PANTS", "DRESS", "SKIRT", "SOCKS", "SHOES", "COAT", "SCARF", "GLOVES", "JACKET", "BOOTS", "BELT", "VEST", "JEANS", "SWEATER", "HOODIE"] },
  { name: "Jobs", label: "jobs", words: ["DOCTOR", "NURSE", "CHEF", "FARMER", "PILOT", "TEACHER", "BAKER", "POLICE", "ARTIST", "SINGER", "DRIVER", "DENTIST", "JUDGE", "WAITER", "ACTOR", "PAINTER"] },
  { name: "School", label: "school things", words: ["BOOK", "PENCIL", "ERASER", "RULER", "DESK", "PAPER", "CLASS", "LUNCH", "CHALK", "TEST", "MATH", "MUSIC", "GLUE", "SCISSORS", "CRAYON", "TEACHER"] },
  { name: "Ocean", label: "ocean things", words: ["FISH", "WHALE", "CRAB", "SHARK", "SHELL", "WAVE", "BOAT", "SAND", "CORAL", "SQUID", "SEAL", "DOLPHIN", "OCTOPUS", "BEACH", "TIDE", "ISLAND"] }
] as const;
