/**
 * GENERIERT von frontend/scripts/build-system-sticker-catalog.mjs.
 * Quelle: public/stickers/manifest.json und die PNGs daneben.
 * Nicht von Hand ändern.
 */

export const STICKER_THEMES = [
  {
    "id": "emotes",
    "labelKey": "messenger.stickerThemes.emotes"
  },
  {
    "id": "love",
    "labelKey": "messenger.stickerThemes.love"
  },
  {
    "id": "food",
    "labelKey": "messenger.stickerThemes.food"
  },
  {
    "id": "gaming",
    "labelKey": "messenger.stickerThemes.gaming"
  },
  {
    "id": "technology",
    "labelKey": "messenger.stickerThemes.technology"
  },
  {
    "id": "cars_travel",
    "labelKey": "messenger.stickerThemes.carsTravel"
  }
] as const

export type StickerThemeId = (typeof STICKER_THEMES)[number]['id']

export interface SystemSticker {
  id: string
  theme: StickerThemeId
  /** Reihenfolge innerhalb des Themas, beginnend bei 1. */
  nummer: number
  /** Pfad im öffentlichen Ordner; kein Nutzerinhalt, fest im Programm. */
  bild: string
  datei: string
}

export const SYSTEM_STICKERS: SystemSticker[] = [
  {
    "id": "sys-emotes-hello-wave",
    "theme": "emotes",
    "nummer": 1,
    "bild": "/stickers/emotes/01_hello_wave.png",
    "datei": "emotes/01_hello_wave.png"
  },
  {
    "id": "sys-emotes-heart-hug",
    "theme": "emotes",
    "nummer": 2,
    "bild": "/stickers/emotes/02_heart_hug.png",
    "datei": "emotes/02_heart_hug.png"
  },
  {
    "id": "sys-emotes-rose-bouquet",
    "theme": "emotes",
    "nummer": 3,
    "bild": "/stickers/emotes/03_rose_bouquet.png",
    "datei": "emotes/03_rose_bouquet.png"
  },
  {
    "id": "sys-emotes-love-smile",
    "theme": "emotes",
    "nummer": 4,
    "bild": "/stickers/emotes/04_love_smile.png",
    "datei": "emotes/04_love_smile.png"
  },
  {
    "id": "sys-emotes-cozy-cuddle",
    "theme": "emotes",
    "nummer": 5,
    "bild": "/stickers/emotes/05_cozy_cuddle.png",
    "datei": "emotes/05_cozy_cuddle.png"
  },
  {
    "id": "sys-emotes-sleepy-cat",
    "theme": "emotes",
    "nummer": 6,
    "bild": "/stickers/emotes/06_sleepy_cat.png",
    "datei": "emotes/06_sleepy_cat.png"
  },
  {
    "id": "sys-emotes-dreamy-cat",
    "theme": "emotes",
    "nummer": 7,
    "bild": "/stickers/emotes/07_dreamy_cat.png",
    "datei": "emotes/07_dreamy_cat.png"
  },
  {
    "id": "sys-emotes-coffee-lover",
    "theme": "emotes",
    "nummer": 8,
    "bild": "/stickers/emotes/08_coffee_lover.png",
    "datei": "emotes/08_coffee_lover.png"
  },
  {
    "id": "sys-emotes-music-headphones",
    "theme": "emotes",
    "nummer": 9,
    "bild": "/stickers/emotes/09_music_headphones.png",
    "datei": "emotes/09_music_headphones.png"
  },
  {
    "id": "sys-emotes-heart-eyes",
    "theme": "emotes",
    "nummer": 10,
    "bild": "/stickers/emotes/10_heart_eyes.png",
    "datei": "emotes/10_heart_eyes.png"
  },
  {
    "id": "sys-love-sending-love",
    "theme": "love",
    "nummer": 1,
    "bild": "/stickers/love/11_sending_love.png",
    "datei": "love/11_sending_love.png"
  },
  {
    "id": "sys-love-cat-cuddle",
    "theme": "love",
    "nummer": 2,
    "bild": "/stickers/love/12_cat_cuddle.png",
    "datei": "love/12_cat_cuddle.png"
  },
  {
    "id": "sys-love-couple-hug",
    "theme": "love",
    "nummer": 3,
    "bild": "/stickers/love/13_couple_hug.png",
    "datei": "love/13_couple_hug.png"
  },
  {
    "id": "sys-love-sunset-together",
    "theme": "love",
    "nummer": 4,
    "bild": "/stickers/love/14_sunset_together.png",
    "datei": "love/14_sunset_together.png"
  },
  {
    "id": "sys-love-forever-together",
    "theme": "love",
    "nummer": 5,
    "bild": "/stickers/love/15_forever_together.png",
    "datei": "love/15_forever_together.png"
  },
  {
    "id": "sys-love-heart-hands",
    "theme": "love",
    "nummer": 6,
    "bild": "/stickers/love/16_heart_hands.png",
    "datei": "love/16_heart_hands.png"
  },
  {
    "id": "sys-love-love-letter",
    "theme": "love",
    "nummer": 7,
    "bild": "/stickers/love/17_love_letter.png",
    "datei": "love/17_love_letter.png"
  },
  {
    "id": "sys-love-heart-frame",
    "theme": "love",
    "nummer": 8,
    "bild": "/stickers/love/18_heart_frame.png",
    "datei": "love/18_heart_frame.png"
  },
  {
    "id": "sys-love-heart-lock",
    "theme": "love",
    "nummer": 9,
    "bild": "/stickers/love/19_heart_lock.png",
    "datei": "love/19_heart_lock.png"
  },
  {
    "id": "sys-love-promise-rings",
    "theme": "love",
    "nummer": 10,
    "bild": "/stickers/love/20_promise_rings.png",
    "datei": "love/20_promise_rings.png"
  },
  {
    "id": "sys-food-burger",
    "theme": "food",
    "nummer": 1,
    "bild": "/stickers/food/21_burger.png",
    "datei": "food/21_burger.png"
  },
  {
    "id": "sys-food-pizza-slice",
    "theme": "food",
    "nummer": 2,
    "bild": "/stickers/food/22_pizza_slice.png",
    "datei": "food/22_pizza_slice.png"
  },
  {
    "id": "sys-food-ramen",
    "theme": "food",
    "nummer": 3,
    "bild": "/stickers/food/23_ramen.png",
    "datei": "food/23_ramen.png"
  },
  {
    "id": "sys-food-sushi",
    "theme": "food",
    "nummer": 4,
    "bild": "/stickers/food/24_sushi.png",
    "datei": "food/24_sushi.png"
  },
  {
    "id": "sys-food-heart-fries",
    "theme": "food",
    "nummer": 5,
    "bild": "/stickers/food/25_heart_fries.png",
    "datei": "food/25_heart_fries.png"
  },
  {
    "id": "sys-food-pancakes",
    "theme": "food",
    "nummer": 6,
    "bild": "/stickers/food/26_pancakes.png",
    "datei": "food/26_pancakes.png"
  },
  {
    "id": "sys-food-chocolate-donut",
    "theme": "food",
    "nummer": 7,
    "bild": "/stickers/food/27_chocolate_donut.png",
    "datei": "food/27_chocolate_donut.png"
  },
  {
    "id": "sys-food-cupcake",
    "theme": "food",
    "nummer": 8,
    "bild": "/stickers/food/28_cupcake.png",
    "datei": "food/28_cupcake.png"
  },
  {
    "id": "sys-food-coffee-mug",
    "theme": "food",
    "nummer": 9,
    "bild": "/stickers/food/29_coffee_mug.png",
    "datei": "food/29_coffee_mug.png"
  },
  {
    "id": "sys-food-bubble-tea",
    "theme": "food",
    "nummer": 10,
    "bild": "/stickers/food/30_bubble_tea.png",
    "datei": "food/30_bubble_tea.png"
  },
  {
    "id": "sys-gaming-gaming-headset",
    "theme": "gaming",
    "nummer": 1,
    "bild": "/stickers/gaming/31_gaming_headset.png",
    "datei": "gaming/31_gaming_headset.png"
  },
  {
    "id": "sys-gaming-victory-gamer",
    "theme": "gaming",
    "nummer": 2,
    "bild": "/stickers/gaming/32_victory_gamer.png",
    "datei": "gaming/32_victory_gamer.png"
  },
  {
    "id": "sys-gaming-vr-headset",
    "theme": "gaming",
    "nummer": 3,
    "bild": "/stickers/gaming/33_vr_headset.png",
    "datei": "gaming/33_vr_headset.png"
  },
  {
    "id": "sys-gaming-hooded-gamer",
    "theme": "gaming",
    "nummer": 4,
    "bild": "/stickers/gaming/34_hooded_gamer.png",
    "datei": "gaming/34_hooded_gamer.png"
  },
  {
    "id": "sys-gaming-afk-cat",
    "theme": "gaming",
    "nummer": 5,
    "bild": "/stickers/gaming/35_afk_cat.png",
    "datei": "gaming/35_afk_cat.png"
  },
  {
    "id": "sys-gaming-health-hearts",
    "theme": "gaming",
    "nummer": 6,
    "bild": "/stickers/gaming/36_health_hearts.png",
    "datei": "gaming/36_health_hearts.png"
  },
  {
    "id": "sys-gaming-game-controller",
    "theme": "gaming",
    "nummer": 7,
    "bild": "/stickers/gaming/37_game_controller.png",
    "datei": "gaming/37_game_controller.png"
  },
  {
    "id": "sys-gaming-gaming-pc",
    "theme": "gaming",
    "nummer": 8,
    "bild": "/stickers/gaming/38_gaming_pc.png",
    "datei": "gaming/38_gaming_pc.png"
  },
  {
    "id": "sys-gaming-gaming-monitor",
    "theme": "gaming",
    "nummer": 9,
    "bild": "/stickers/gaming/39_gaming_monitor.png",
    "datei": "gaming/39_gaming_monitor.png"
  },
  {
    "id": "sys-gaming-winner-crown",
    "theme": "gaming",
    "nummer": 10,
    "bild": "/stickers/gaming/40_winner_crown.png",
    "datei": "gaming/40_winner_crown.png"
  },
  {
    "id": "sys-technology-laptop-cat",
    "theme": "technology",
    "nummer": 1,
    "bild": "/stickers/technology/41_laptop_cat.png",
    "datei": "technology/41_laptop_cat.png"
  },
  {
    "id": "sys-technology-code-screen",
    "theme": "technology",
    "nummer": 2,
    "bild": "/stickers/technology/42_code_screen.png",
    "datei": "technology/42_code_screen.png"
  },
  {
    "id": "sys-technology-tech-wrench",
    "theme": "technology",
    "nummer": 3,
    "bild": "/stickers/technology/43_tech_wrench.png",
    "datei": "technology/43_tech_wrench.png"
  },
  {
    "id": "sys-technology-settings-gears",
    "theme": "technology",
    "nummer": 4,
    "bild": "/stickers/technology/44_settings_gears.png",
    "datei": "technology/44_settings_gears.png"
  },
  {
    "id": "sys-technology-server-stack",
    "theme": "technology",
    "nummer": 5,
    "bild": "/stickers/technology/45_server_stack.png",
    "datei": "technology/45_server_stack.png"
  },
  {
    "id": "sys-technology-cloud-upload",
    "theme": "technology",
    "nummer": 6,
    "bild": "/stickers/technology/46_cloud_upload.png",
    "datei": "technology/46_cloud_upload.png"
  },
  {
    "id": "sys-technology-security-shield",
    "theme": "technology",
    "nummer": 7,
    "bild": "/stickers/technology/47_security_shield.png",
    "datei": "technology/47_security_shield.png"
  },
  {
    "id": "sys-technology-wifi-signal",
    "theme": "technology",
    "nummer": 8,
    "bild": "/stickers/technology/48_wifi_signal.png",
    "datei": "technology/48_wifi_signal.png"
  },
  {
    "id": "sys-technology-battery-full",
    "theme": "technology",
    "nummer": 9,
    "bild": "/stickers/technology/49_battery_full.png",
    "datei": "technology/49_battery_full.png"
  },
  {
    "id": "sys-technology-idea-cat",
    "theme": "technology",
    "nummer": 10,
    "bild": "/stickers/technology/50_idea_cat.png",
    "datei": "technology/50_idea_cat.png"
  },
  {
    "id": "sys-cars_travel-sports-car",
    "theme": "cars_travel",
    "nummer": 1,
    "bild": "/stickers/cars_travel/51_sports_car.png",
    "datei": "cars_travel/51_sports_car.png"
  },
  {
    "id": "sys-cars_travel-cool-driver",
    "theme": "cars_travel",
    "nummer": 2,
    "bild": "/stickers/cars_travel/52_cool_driver.png",
    "datei": "cars_travel/52_cool_driver.png"
  },
  {
    "id": "sys-cars_travel-racing-flag",
    "theme": "cars_travel",
    "nummer": 3,
    "bild": "/stickers/cars_travel/53_racing_flag.png",
    "datei": "cars_travel/53_racing_flag.png"
  },
  {
    "id": "sys-cars_travel-tire",
    "theme": "cars_travel",
    "nummer": 4,
    "bild": "/stickers/cars_travel/54_tire.png",
    "datei": "cars_travel/54_tire.png"
  },
  {
    "id": "sys-cars_travel-speedometer",
    "theme": "cars_travel",
    "nummer": 5,
    "bild": "/stickers/cars_travel/55_speedometer.png",
    "datei": "cars_travel/55_speedometer.png"
  },
  {
    "id": "sys-cars_travel-fuel-pump",
    "theme": "cars_travel",
    "nummer": 6,
    "bild": "/stickers/cars_travel/56_fuel_pump.png",
    "datei": "cars_travel/56_fuel_pump.png"
  },
  {
    "id": "sys-cars_travel-road-trip",
    "theme": "cars_travel",
    "nummer": 7,
    "bild": "/stickers/cars_travel/57_road_trip.png",
    "datei": "cars_travel/57_road_trip.png"
  },
  {
    "id": "sys-cars_travel-camping-tent",
    "theme": "cars_travel",
    "nummer": 8,
    "bild": "/stickers/cars_travel/58_camping_tent.png",
    "datei": "cars_travel/58_camping_tent.png"
  },
  {
    "id": "sys-cars_travel-camping-coffee",
    "theme": "cars_travel",
    "nummer": 9,
    "bild": "/stickers/cars_travel/59_camping_coffee.png",
    "datei": "cars_travel/59_camping_coffee.png"
  },
  {
    "id": "sys-cars_travel-mountains",
    "theme": "cars_travel",
    "nummer": 10,
    "bild": "/stickers/cars_travel/60_mountains.png",
    "datei": "cars_travel/60_mountains.png"
  }
]

const NACH_KENNUNG = new Map(SYSTEM_STICKERS.map((eintrag) => [eintrag.id, eintrag]))

export function systemSticker(id: string): SystemSticker | undefined {
  return NACH_KENNUNG.get(id)
}
