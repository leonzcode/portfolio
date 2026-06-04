export interface Project {
  slug: string;
  title: string;
  description: string;
  href: string;
  localHref?: string;
  image?: string;
  tag?: string;
  story?: string[];
  tech?: string[];
  screenshots?: string[];
  detailHref?: string;
  hideOpenFullApp?: boolean;
}

export const aiProjects: Project[] = [
  {
    slug: "avalanche",
    title: "Avalanche Risk Forecasting",
    description:
      "Physics-informed ML model that forecasts avalanche risk at 2–5 km resolution from satellite, snowpack, and weather data. 3rd Place, Engineering — Golden Gate STEM Fair.",
    href: "https://apps.leonzhao.dev/avalanche/",
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
    image: "/cards/card_art_detector.png",
    tag: "Live demo",
    story: [
      "Final project for COSMOS Machine Learning Cluster at UC San Diego. The model can classify if an image is AI generated or human made by identifying poor and rich contrasts within the image pixels.",
      "The model was trained using different algorithms, like logistic regression, decision trees, and neural networks. The final model was the MLP neural network that was adjusted with CNN augmentation. Each layer of the neural network was trained on a specific subject, such as color statistics, pixel gradients, and texture variants. The final model achieved a 98% accuracy on held out testing data.",
    ],
    tech: ["Python", "TensorFlow / Keras", "CNN with transfer learning", "Streamlit"],
  },
  {
    slug: "trash",
    title: "Trash Classifier",
    description:
      "EfficientNetV2 CNN that sorts a photo of waste into 9 recycling categories and tells you which bin it belongs in.",
    href: "https://apps.leonzhao.dev/trash/",
    image: "/cards/card_trash.png",
    tag: "Live demo",
    story: [
      "Image classifier that takes a photo of a single piece of waste and predicts which of 9 categories it belongs to: cardboard, food organics, glass, metal, miscellaneous trash, paper, plastic, textile trash, or vegetation.",
      "Built on EfficientNetV2-B0 with transfer learning. The backbone was pretrained on ImageNet, then fine-tuned on the RealWaste dataset (about 4,800 photos taken under realistic landfill lighting, not studio shots). Heavy on-the-fly augmentation (rotation, shifts, brightness jitter, horizontal flips) plus class-weighted loss handled the dataset imbalance.",
      "The motivation was contamination. Single-stream recycling fails when people guess wrong about what's actually recyclable, so a model that can look at an item and tell you the correct bin is a small step toward higher-quality recovered material.",
    ],
    tech: ["Python", "TensorFlow / Keras", "EfficientNetV2-B0 transfer learning", "RealWaste dataset (Kaggle)", "Streamlit"],
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
    hideOpenFullApp: true,
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
    hideOpenFullApp: true,
  },
];

// Mark AI projects as having detail pages
aiProjects.forEach((p) => {
  p.detailHref = `/ai/${p.slug}`;
});

export const gameProjects: Project[] = [
  {
    slug: "basket",
    title: "Sports Un-random",
    description:
      "Browser minigames inspired by sports random. Use left, right, and up keys to move and down key to shoot",
    href: "https://leonzcode.github.io/basket/",
    image: "/cards/card_basket.png",
    tag: "Live demo",
  },
  {
    slug: "blackjoy",
    title: "Black Joy",
    description: "Interactive simulation to celebrate black culture and resistance against Jim Crow Laws",
    href: "https://leonzcode.github.io/blackjoy/",
    image: "/cards/card_blackjoy.png",
    tag: "Live demo",
  },
  {
    slug: "ski",
    title: "Leonski",
    description:
      "Endless ski-down game. Dodge trees, build speed, see how long you can stay alive.",
    href: "https://leonzcode.github.io/ski/",
    image: "/cards/card_ski.png",
    tag: "Live demo",
  },
  {
    slug: "coconut",
    title: "Coconut Simulator",
    description: "Idle clicker — every tap shakes more coconuts from the tree.",
    href: "https://leonzcode.github.io/coconut/",
    image: "/cards/card_coconut.png",
    tag: "Live demo",
  },
  {
    slug: "car",
    title: "Neon Velocity",
    description: "Top-down arcade racer with a neon aesthetic. Steer the corners, don't crash.",
    href: "https://leonzcode.github.io/car/",
    image: "/cards/card_car.png",
    tag: "Live demo",
  },
  {
    slug: "clash",
    title: "Clash Royale",
    description:
      "Tower-defense card game in the Clash Royale mold — deploy troops, defend your tower, take down the opponent's.",
    href: "https://leonzcode.github.io/clash/",
    image: "/cards/card_clash.png",
    tag: "Live demo",
  },
  {
    slug: "imposter",
    title: "Imposter Game",
    description: "Among Us-style social deduction game playable in a single browser session.",
    href: "https://leonzcode.github.io/imposter/",
    image: "/cards/card_imposter.png",
    tag: "Live demo",
  },
  {
    slug: "slope",
    title: "Slope",
    description:
      "Steer a rolling ball down a procedurally-extending 3D slope. Avoid obstacles, accumulate speed.",
    href: "https://leonzcode.github.io/slope/",
    image: "/cards/card_slope.png",
    tag: "Live demo",
  },
  {
    slug: "platformer",
    title: "Leon's Platformer",
    description:
      "Side-scrolling 2D platformer with jump, double-jump, and hand-designed levels.",
    href: "https://leonzcode.github.io/platformer/",
    image: "/cards/card_platformer.png",
    tag: "Live demo",
  },
  {
    slug: "wordle-game",
    title: "Leon's Wordle",
    description:
      "Browser Wordle clone — guess the five-letter word in six tries. (Different from the AI Wordle Solver under AI projects.)",
    href: "https://leonzcode.github.io/wordle/",
    image: "/cards/card_wordle-game.png",
    tag: "Live demo",
  },
  {
    slug: "blackjack",
    title: "Blackjack Game",
    description: "Single-player blackjack against a simulated dealer — hit, stand, double down.",
    href: "https://leonzcode.github.io/blackjack/",
    image: "/cards/card_blackjack.png",
    tag: "Live demo",
  },
  {
    slug: "tennis",
    title: "Tennis",
    description: "Two-player tennis on one keyboard. Left and right paddles bounce the ball back and forth.",
    href: "https://leonzcode.github.io/tennis/",
    image: "/cards/card_tennis.png",
    tag: "Live demo",
  },
  {
    slug: "leon-2048",
    title: "LEON 2048",
    description: "2048 number-merging puzzle reskinned with my own tile art.",
    href: "https://leonzcode.github.io/LEON/",
    image: "/cards/card_leon-2048.png",
    tag: "Live demo",
  },
  {
    slug: "tetris",
    title: "Tetris",
    description: "Browser Tetris — falling tetrominoes, line clears, speed ramps up as you progress.",
    href: "https://leonzcode.github.io/Tetris/",
    image: "/cards/card_tetris.png",
    tag: "Live demo",
  },
  {
    slug: "pong",
    title: "Pong",
    description: "Classic Pong. Two paddles, one ball, first to ten.",
    href: "https://leonzcode.github.io/pong/",
    image: "/cards/card_pong.png",
    tag: "Live demo",
  },
  {
    slug: "snake",
    title: "Snake",
    description: "Classic Snake — eat food, grow longer, avoid your own tail.",
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

export const physicsProjects: Project[] = [
  {
    slug: "doppler",
    title: "Doppler Effect Simulator",
    description:
      "Interactive simulator using the doppler formula and distance-based amplitudde attenuatoin to simlate the doppler effect",
    href: "https://leonzcode.github.io/doppler/",
    image: "/cards/card_doppler.png",
    tag: "Live demo",
  },
  {
    slug: "circuit",
    title: "Circuit Builder",
    description:
      "Interactive lab that allows users to simulate circuit building and explore Ohm's law and Kirkoff's rules",
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

physicsProjects.forEach((p) => {
  p.detailHref = `/physics/${p.slug}`;
});

const localProjectPaths: Record<string, string> = {
  basket: "/legacy/basket-random/index.html",
  blackjoy: "/legacy/doubledutch3d.html",
  ski: "/legacy/ski.html",
  coconut: "/legacy/coconut.html",
  car: "/legacy/car.html",
  clash: "/legacy/clash.html",
  imposter: "/legacy/imposter.html",
  slope: "/legacy/slope.html",
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

[gameProjects, mathProjects, physicsProjects].forEach((group) => {
  group.forEach((project) => {
    const localHref = localProjectPaths[project.slug];
    if (localHref) {
      project.localHref = localHref;
    }
  });
});
