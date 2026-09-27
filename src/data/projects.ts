export interface Project {
  slug: string;
  title: string;
  description: string;
  href: string;
  repo?: string;
  localHref?: string;
  image?: string;
  tag?: string;
  story?: string[];
  tech?: string[];
  screenshots?: string[];
  detailHref?: string;
}

export const aiProjects: Project[] = [
  {
    slug: "avalanche",
    title: "Avalanche Risk Forecasting",
    description:
      "Physics-informed ML model that forecasts avalanche risk at 2–5 km resolution from satellite, snowpack, and weather data. 3rd Place, Engineering — Golden Gate STEM Fair.",
    href: "https://apps.leonzhao.dev/avalanche/",
    repo: "https://github.com/leonzcode/avalanche-risk-forecasting",
    image: "/cards/card_avalanche.png",
    tag: "Live demo",
    story: [
      "Built a physics-informed machine-learning model that forecasts avalanche risk at 2–5 km resolution. Inputs include satellite imagery, snowpack depth and stability indicators, recent weather, and terrain — features that physical avalanche models traditionally use, now combined with ML to handle their interactions.",
      "Test accuracy reached 83% on held-out data. Temperature gradients and water-content features emerged as the strongest predictors. The open-source web tool returns risk estimates for any user-selected map coordinates.",
      "I'm a longtime snowboarder, and the project started as a way to bring data science to mountains I actually ride. Current work focuses on recall, false-negative analysis, and data-leakage checks before I'd trust it for real safety use.",
      "3rd Place, Engineering — Golden Gate STEM Fair (ISEF-affiliated regional).",
    ],
    tech: ["Python", "scikit-learn", "PINN (physics-informed neural network)", "Streamlit", "Folium for map UI"],
  },
  {
    slug: "ai-art",
    title: "AI Art Detection",
    description:
      "CNN classifier that distinguishes AI-generated images from human-made art, built during COSMOS @ UC San Diego.",
    href: "https://apps.leonzhao.dev/ai-art/",
    repo: "https://github.com/leonzcode/ai-art-detector",
    image: "/cards/card_art_detector.png",
    tag: "Live demo",
    story: [
      "Final project for COSMOS Machine Learning Cluster at UC San Diego. The model can classify if an image is AI generated or human made by identifying poor and rich contrasts within the image pixels.",
      "The model was trained using different algorithms, like logistic regression, decision trees, and neural networks. The final model was the MLP neural network that was adjusted with CNN augmentation. Each layer of the neural network was trained on a specific subject, such as color statistics, pixel gradients, and texture variants. The final model achieved a 98% accuracy on held out testing data.",
    ],
    tech: ["Python", "TensorFlow / Keras", "CNN with transfer learning", "Streamlit"],
  },
  {
    slug: "litterbot",
    title: "LitterBot AI",
    description:
      "EfficientNetV2 CNN that sorts a photo of waste into 9 recycling categories and tells you which bin it belongs in, built in Litterbot design, achieved DSWA innovation award at Diamond Challenge finalists.",
    href: "https://apps.leonzhao.dev/litterbot/",
    repo: "https://github.com/leonzcode/litterbot-ai",
    image: "/cards/card_litterbot.png",
    tag: "Live demo",
    story: [
      "Image classifier that takes a photo of a single piece of waste and predicts which of 9 categories it belongs to: cardboard, food organics, glass, metal, miscellaneous trash, paper, plastic, textile trash, or vegetation.",
      "Built on EfficientNetV2-B0 with transfer learning. The backbone was pretrained on ImageNet, then fine-tuned on the RealWaste dataset (about 4,800 photos taken under realistic landfill lighting, not studio shots). Heavy on-the-fly augmentation (rotation, shifts, brightness jitter, horizontal flips) plus class-weighted loss handled the dataset imbalance. The fine-tuned model reaches about 87.6% validation accuracy.",
      "The image classifier was built for Litterbot, a robot that autonomously navigates, picks up, and sorts pieces of trash. The proposed design gives Litterbot cameras that use a YOLO algorithm to scan its surroundings and identify pieces of trash. Litterbot then moves to the trash and uses a separate EfficientNetV2-B0 CNN to classify what type of trash it is. Litterbot qualified for the Diamond Challenge Finalists Limitless World Summit, where it won the Delaware Solid Waste Authority (DSWA) Waste and Recycling Innovation award.",
    ],
    tech: [
      "Python",
      "EfficientNetV2-B0 transfer learning (Keras, fine-tuned)",
      "RealWaste dataset (Kaggle, ~4.8k images, 9 classes)",
      "TFLite inference via ai-edge-litert",
      "Streamlit",
    ],
  },
  {
    slug: "aihiring",
    title: "Bias in AI Hiring Systems",
    description:
      "The effects of bias and discrimination within new AI hiring systems on marginalized communities.",
    href: "https://leonzhao.dev/apps/aihiring/",
    image: "/cards/card_aihiring.png",
    tag: "Research",
    story: [
      "This research paper raises awareness about how people of color are being discriminated against by AI hiring systems. It talks about the effects, causes, and solutions to the issue. Research also includes an overview of different machine learning algorithms, such as Gradient Boosting, HistGBM, and neural networks, used to replicate AI hiring models to simulate bias.",
      "The argument leans on two real studies: the Bertrand & Mullainathan 2004 labor-market audit (the original \"Jamal vs. Greg\" résumé experiment) and a 2025 Brookings analysis showing that 98.4% of Fortune 500 companies now use AI somewhere in hiring.",
    ],
    tech: ["HTML/CSS/JS scrollytelling", "Custom data visualizations", "GitHub Pages"],
  },
  {
    slug: "wordle",
    title: "Wordle Solver",
    description:
      "Daily wordle solver using Shannon entropy models.",
    href: "https://leonzhao.dev/apps/wordle/",
    image: "/cards/card_wordle_solver.png",
    tag: "Live demo",
    story: [],
    tech: ["JavaScript (vanilla)", "Information theory / entropy ranking", "GitHub Pages static hosting"],
  },
];

// Mark AI projects as having detail pages
aiProjects.forEach((p) => {
  p.detailHref = `/ai/${p.slug}`;
});

export const gameProjects: Project[] = [
  {
    slug: "leon-kart",
    title: "Leon Kart",
    description:
      "An original kart racer with five circuits that are drawn fresh every race, drift mini-turbos, gliders, items, and a server so you can race other people.",
    href: "/mario/",
    image: "/cards/mario1.png",
    tag: "Multiplayer",
    story: [
      "A kart racer written from scratch with Three.js. None of it is anybody else's: the cars, the circuits, the items and the music are all either generated in code or built from CC0 art, and the five places you race are laid out by the game rather than drawn by hand. Each round picks a seed and builds a closed circuit from it, then hangs ten sections off that lap, so Sunfield Loop is recognisably Sunfield Loop every time while never being quite the same lap twice.",
      "The places do not just look different, they drive differently. Glacier Pass takes the grip away and puts ice down one side of a straight, Redrock Dunes is the narrowest road on the calendar with two canyon gaps you have to be launched over, Neon Mile is half boost pad and has an anti-gravity stretch where running into somebody throws you both forward, and Ember Hollow has the biggest jumps and ground that erupts under you. Falling into a gap gets you fished out by a balloon and set back down where you went in.",
      "Most of the work went into how it feels rather than what it does. A drift charges in tiers you can hear as well as see, and the boost it pays is worth what you held it for. Leaving a ramp is a projectile problem and nothing else, so the arc is real and there is no bounce on the way down. Sitting in somebody's air for a few seconds drags you along with them. You can hold an item behind the car instead of throwing it, where it shields your back. Everything bolted to the kart changes how it drives, and the multiplayer runs against a small Node server on my own VPS.",
    ],
    tech: [
      "Three.js (WebGL), no build step, plain ES modules",
      "Circuits generated per race from a seed: Catmull-Rom spline, ten placed sections, smoothing and gradient passes",
      "Kart physics: projectile jumps, tiered drift charge, slipstream, gliders, per-part handling stats",
      "Instanced scenery and merged geometry to hold the draw calls down",
      "Node + ws lobby server on a Hetzner VPS for multiplayer rounds",
    ],
  },
  {
    slug: "minecraft",
    title: "Leoncraft",
    description:
      "A voxel sandbox built from scratch in the browser: procedural worlds, hundreds of blocks, mobs, and a shared multiplayer server where you build alongside other people live.",
    href: "/legacy/minecraft.html",
    image: "/cards/card_minecraft.png",
    tag: "Multiplayer",
    story: [
      "A block-building sandbox written from scratch with Three.js, in the spirit of Minecraft but with none of its assets. The terrain is generated procedurally from Perlin noise, split into chunks, and meshed with face culling and ambient occlusion so it stays smooth even with a large world loaded. Every texture is painted onto a canvas when the page loads, so nothing is copied from the original game.",
      "It comes with hundreds of placeable blocks, sorted into creative-style categories with a search bar, and each block behaves the way you would expect: water flows, sand and gravel fall, glass and leaves let light through, and you can sneak along an edge without falling off. You can fly, break and place blocks, and spawn a couple of custom creatures.",
      "The multiplayer mode connects to a small server I run on my own VPS. Everyone who joins shares one persistent world: you see other players move and place blocks in real time, the world autosaves and loads back the same every time, and you can talk to the room by pressing T to chat. The server is an authoritative relay written in Node, it hands out the shared world seed and every edit so all players stay in sync.",
    ],
    tech: [
      "Three.js (WebGL), single file, no build step",
      "Chunked voxel engine: face-culled meshing + ambient occlusion",
      "Procedural Perlin terrain, canvas-generated textures",
      "Node.js + ws multiplayer relay (shared seed, block persistence)",
      "Self-hosted on a Hetzner VPS behind Caddy over secure WebSocket",
    ],
  },
  {
    slug: "slope",
    title: "Slope",
    description:
      "A ball rolling down an endless neon slope, faster and faster. Play solo or race a friend in split screen.",
    href: "https://leonzcode.github.io/slope/",
    image: "/cards/card_slope.png",
    tag: "Live demo",
  },
  {
    slug: "leon-slope",
    title: "Leon Slope",
    description:
      "My first crack at Slope, weaving a ball past shifting platforms down a colorful 3D course.",
    href: "/legacy/leonslope.html",
    image: "/cards/card_leonslope.png",
    tag: "Live demo",
  },
  {
    slug: "basket",
    title: "Sports Un-random",
    description:
      "Goofy physics sports minigames in the spirit of the Random series.",
    href: "https://leonzcode.github.io/basket/",
    image: "/cards/card_basket.png",
    tag: "Live demo",
  },
  {
    slug: "blackjoy",
    title: "Black Joy",
    description: "A 3D double dutch game about rhythm, community, and Black joy.",
    href: "https://leonzcode.github.io/blackjoy/",
    image: "/cards/card_blackjoy.png",
    tag: "Live demo",
  },
  {
    slug: "ski",
    title: "Leonski",
    description:
      "Ski downhill forever and see how long you last before you wipe out.",
    href: "https://leonzcode.github.io/ski/",
    image: "/cards/card_ski.png",
    tag: "Live demo",
  },
  {
    slug: "leonski2",
    title: "Leonski 2",
    description:
      "A skiing sandbox that rebuilds real mountains from map data, so you can ride any resort in the world.",
    href: "/legacy/leonski2.html",
    image: "/cards/card_leonski2.png",
    tag: "Live demo",
    story: [
      "A full 3D skiing sandbox that reconstructs real ski resorts on the fly. Search any mountain in the world and it pulls the pistes and lifts from OpenStreetMap, elevation from public terrain DEM tiles, and satellite imagery, then builds a playable snow-covered mountain in your browser with Three.js.",
      "Ski it in third person with carving, jumps, butters, grabs, and spins, or switch to a free-fly camera to explore. Ride the chairlifts, gondolas, T-bars, and magic carpets back up, then bomb down again. No installs, no accounts, everything reconstructed live from open data.",
    ],
    tech: ["Three.js (WebGL)", "OpenStreetMap Overpass API", "AWS Terrain DEM tiles", "Esri satellite imagery", "Single-file, zero build step"],
  },
  {
    slug: "coconut",
    title: "Coconut Simulator",
    description: "An idle clicker about shaking coconuts loose from a tree.",
    href: "https://leonzcode.github.io/coconut/",
    image: "/cards/card_coconut.png",
    tag: "Live demo",
  },
  {
    slug: "car",
    title: "Neon Velocity",
    description: "A neon top-down racer around tight corners.",
    href: "https://leonzcode.github.io/car/",
    image: "/cards/card_car.png",
    tag: "Live demo",
  },
  {
    slug: "clash",
    title: "Clash Royale",
    description:
      "A browser take on Clash Royale, dropping troops to topple the other side's towers.",
    href: "https://leonzcode.github.io/clash/",
    image: "/cards/card_clash.png",
    tag: "Live demo",
  },
  {
    slug: "imposter",
    title: "Imposter Game",
    description: "Among Us style social deduction for a group huddled around one screen.",
    href: "https://leonzcode.github.io/imposter/",
    image: "/cards/card_imposter.png",
    tag: "Live demo",
  },
  {
    slug: "castlefall",
    title: "Castlefall",
    description:
      "A hidden-teams party word game you pass around a single phone.",
    href: "/legacy/castlefall.html",
    image: "/cards/card_castlefall.png",
    tag: "Live demo",
  },
  {
    slug: "platformer",
    title: "Leon's Platformer",
    description:
      "A 2D platformer with levels I laid out by hand.",
    href: "https://leonzcode.github.io/platformer/",
    image: "/cards/card_platformer.png",
    tag: "Live demo",
  },
  {
    slug: "wordle-game",
    title: "Leon's Wordle",
    description:
      "My own Wordle, hunting down the hidden five-letter word.",
    href: "https://leonzcode.github.io/wordle/",
    image: "/cards/card_wordle-game.png",
    tag: "Live demo",
  },
  {
    slug: "blackjack",
    title: "Blackjack Game",
    description: "A hand of blackjack against a computer dealer.",
    href: "https://leonzcode.github.io/blackjack/",
    image: "/cards/card_blackjack.png",
    tag: "Live demo",
  },
  {
    slug: "tennis",
    title: "Tennis",
    description: "Two-player tennis sharing one keyboard.",
    href: "https://leonzcode.github.io/tennis/",
    image: "/cards/card_tennis.png",
    tag: "Live demo",
  },
  {
    slug: "leon-2048",
    title: "LEON 2048",
    description: "The 2048 sliding puzzle, reskinned with my own tiles.",
    href: "https://leonzcode.github.io/LEON/",
    image: "/cards/card_leon-2048.png",
    tag: "Live demo",
  },
  {
    slug: "tetris",
    title: "Tetris",
    description: "Browser Tetris that speeds up the longer you survive.",
    href: "https://leonzcode.github.io/Tetris/",
    image: "/cards/card_tetris.png",
    tag: "Live demo",
  },
  {
    slug: "pong",
    title: "Pong",
    description: "Old-school Pong, two paddles and a ball.",
    href: "https://leonzcode.github.io/pong/",
    image: "/cards/card_pong.png",
    tag: "Live demo",
  },
  {
    slug: "snake",
    title: "Snake",
    description: "Classic Snake, growing longer without tangling into yourself.",
    href: "https://leonzcode.github.io/snake/",
    image: "/cards/card_snake.png",
    tag: "Live demo",
  },
];

gameProjects.forEach((p) => {
  p.detailHref = `/games/${p.slug}`;
});

export const mathProjects: Project[] = [
  {
    slug: "polar",
    title: "Polar Graphing Calculator",
    description:
      "Polar coordinate graphing calculator",
    href: "https://leonzcode.github.io/polar/",
    image: "/cards/card_polar.png",
    tag: "Live demo",
  },
  {
    slug: "euler",
    title: "Euler's Method Solver",
    description:
      "Approximations of first order ODEs using Euler's method",
    href: "https://leonzcode.github.io/euler/",
    image: "/cards/card_euler.png",
    tag: "Live demo",
  },
  {
    slug: "calculus",
    title: "Calculus Solver",
    description:
      "Calculator for derivatives, integrals, and areas using the disk and washer methods",
    href: "https://leonzcode.github.io/calculus/",
    image: "/cards/card_calculus.png",
    tag: "Live demo",
  },
  {
    slug: "polynomial",
    title: "Polynomial Solver",
    description:
      "Approximates roots of quintic polynomials using Durand–Kerner and Newton's methods",
    href: "https://leonzcode.github.io/polynomial/",
    image: "/cards/card_polynomial.png",
    tag: "Live demo",
  },
  {
    slug: "unit-circle",
    title: "Unit Circle",
    description:
      "Interactive unit circle simulation",
    href: "https://leonzcode.github.io/unit-circle/",
    image: "/cards/card_unit-circle.png",
    tag: "Live demo",
  },
];

mathProjects.forEach((p) => {
  p.detailHref = `/math/${p.slug}`;
});

export const scienceProjects: Project[] = [
  {
    slug: "ski-resort",
    title: "Ski Resort Trail Map",
    description:
      "Interactive 3D ski resort map recreating OpenSkiMap: search any ski area worldwide, view lifts and runs with difficulty colors, 3D terrain with contours, satellite imagery, and live mountain weather.",
    href: "/legacy/skiresort.html",
    image: "/cards/card_ski-resort.png",
    tag: "Live demo",
    story: [
      "A from-scratch recreation of OpenSkiMap.org in a single HTML file. MapLibre GL JS draws the mountain in tilted 3D terrain (with a 2D toggle), elevation comes from public Terrarium DEM tiles, and contour lines are generated client-side with maplibre-contour, the same library stack the real site uses.",
      "Search any ski area in the world with autocomplete backed by OpenSkiMap's ski-area dataset and OpenStreetMap's Nominatim geocoder. Selecting a resort pulls its lifts and pistes live from the Overpass API and draws them in the standard difficulty colors (green, blue, red, black, with purple lifts), over a terrain or satellite base layer.",
      "A weather panel fetches the Open-Meteo forecast for the selected mountain: snow, wind, and sun conditions by date and time, plus an avalanche indicator. Like the avalanche forecasting project, this one started with snowboarding: I wanted to understand the trail maps I ride with, then rebuild them.",
    ],
    tech: [
      "MapLibre GL JS + maplibre-contour",
      "OpenStreetMap + Overpass API (lifts and pistes)",
      "OpenSkiMap ski-area dataset + Nominatim search",
      "Terrarium DEM terrain tiles (3D terrain, elevation, contours)",
      "Open-Meteo weather API",
      "Vanilla JS, single-file HTML",
    ],
  },
  {
    slug: "gas-lab",
    title: "Gas Properties Lab",
    description:
      "PhET-style ideal-gas lab: heat the gas with a burner, resize the container, and set the pressure while live gauges and a P–V diagram show how the number of particles, volume, temperature, and pressure track the ideal gas law.",
    href: "/legacy/gas-lab.html",
    image: "/cards/card_gas-lab.png",
    tag: "Live demo",
    story: [
      "A 2D ideal gas built from scratch: a few hundred disks that collide elastically with each other and the walls. Pressure is measured the honest way, from the momentum the particles deliver to the walls each moment, and temperature comes straight from the average kinetic energy. Every reading emerges from the mechanics rather than being typed in.",
      "The controls are the state variables of the ideal gas law. A burner under the container heats the gas (higher temperature means faster particles and a taller flame), the width and height sliders set the volume, and a pressure slider compresses or expands the box to demonstrate Boyle's law. Live bars for N, V, T, and P plus a P–V diagram with the state point riding along its isotherm show how a change in one variable moves the others.",
      "I styled it after the PhET simulations my class uses. The goal was a sandbox where an AP Physics 2 student can build intuition for PV = nRT and the first law by watching the numbers change next to the particles that cause them.",
    ],
    tech: [
      "HTML5 canvas, vanilla JS (single file)",
      "Elastic 2D collision resolution (impulse along the contact normal)",
      "Maxwell–Boltzmann speed sampling with a live histogram",
      "Kinetic-theory pressure from wall momentum, temperature from average KE",
      "Ideal gas relations and Boyle's-law compression",
    ],
  },
  {
    slug: "doppler",
    title: "Doppler Effect Simulator",
    description:
      "Interactive simulator using the Doppler formula and distance-based amplitude attenuation to simulate the Doppler effect",
    href: "https://leonzcode.github.io/doppler/",
    image: "/cards/card_doppler.png",
    tag: "Live demo",
  },
  {
    slug: "circuit",
    title: "Circuit Builder",
    description:
      "Interactive lab that allows users to simulate circuit building and explore Ohm's law and Kirchhoff's rules",
    href: "https://leonzcode.github.io/circuit/",
    image: "/cards/card_circuit.png",
    tag: "Live demo",
  },
  {
    slug: "kinetic-theory",
    title: "Kinetic Theory Simulator",
    description:
      "2D gas-particle simulator of kinetic theory using thermodynamic equations and energy balance",
    href: "https://leonzcode.github.io/kinetic-theory/",
    image: "/cards/card_kinetic-theory.png",
    tag: "Live demo",
  },
];

scienceProjects.forEach((p) => {
  p.detailHref = `/science/${p.slug}`;
});

const localProjectPaths: Record<string, string> = {
  basket: "/legacy/basket-random/index.html",
  blackjoy: "/legacy/doubledutch3d.html",
  ski: "/legacy/ski.html",
  leonski2: "/legacy/leonski2.html",
  coconut: "/legacy/coconut.html",
  car: "/legacy/car.html",
  clash: "/legacy/clash.html",
  imposter: "/legacy/imposter.html",
  castlefall: "/legacy/castlefall.html",
  slope: "/legacy/slope.html",
  "leon-slope": "/legacy/leonslope.html",
  platformer: "/legacy/platformer.html",
  "wordle-game": "/legacy/wordle.html",
  blackjack: "/legacy/blackjack.html",
  tennis: "/legacy/tennis.html",
  "leon-2048": "/legacy/2048.html",
  tetris: "/legacy/tetris.html",
  pong: "/legacy/pong.html",
  snake: "/legacy/snake.html",
  polar: "/legacy/polar.html",
  euler: "/legacy/euler.html",
  calculus: "/legacy/derivative.html",
  polynomial: "/legacy/polynomial.html",
  "unit-circle": "/legacy/unitcircle.html",
  doppler: "/legacy/doppler.html",
  circuit: "/legacy/circuit.html",
  "kinetic-theory": "/legacy/particle.html",
};

[gameProjects, mathProjects, scienceProjects].forEach((group) => {
  group.forEach((project) => {
    const localHref = localProjectPaths[project.slug];
    if (localHref) {
      project.localHref = localHref;
    }
  });
});
