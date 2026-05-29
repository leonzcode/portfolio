export interface Project {
  slug: string;
  title: string;
  description: string;
  href: string;
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
      "CNN classifier that distinguishes AI-generated images from human-made art; improved accuracy from 66% to 98% through model iterations during COSMOS @ UC San Diego.",
    href: "https://apps.leonzhao.dev/ai-art/",
    image: "/cards/card_art_detector.png",
    tag: "Live demo",
    story: [
      "Final project from the COSMOS Machine Learning Cluster at UC San Diego. The model classifies whether a given image is AI-generated or human-made — a fast-moving target since the generative landscape shifts every few months.",
      "Starting baseline was 66% accuracy (logistic regression on image statistics). After iterating through KNN, MLPs, and finally a fine-tuned CNN with augmentation, the final model reached 98% accuracy on the held-out test set.",
      "The bigger lesson was about the model-iteration loop itself: each architecture revealed a different failure mode (color statistics fooled the early models; texture features fooled later ones), and the final accuracy came from understanding those failures, not from picking a fancier model.",
    ],
    tech: ["Python", "TensorFlow / Keras", "CNN with transfer learning", "Streamlit"],
  },
  {
    slug: "aihiring",
    title: "Bias in AI Hiring Systems",
    description:
      "Long-form research investigation into how AI résumé screeners disadvantage marginalized applicants. Built as an interactive scrollytelling site rather than a static PDF.",
    href: "https://leoniscooler.github.io/aihiring/",
    image: "/cards/card_aihiring.png",
    tag: "Research",
    story: [
      "A research paper I wrote for Humanities 11, reworked as an interactive web piece. Walks through how AI hiring systems disproportionately reject applicants from marginalized communities, why those biases emerge from training data, and what mitigations actually work.",
      "The argument leans on two real studies: the Bertrand & Mullainathan 2004 labor-market audit (the original \"Jamal vs. Greg\" résumé experiment) and a 2025 Brookings analysis showing that 98.4% of Fortune 500 companies now use AI somewhere in hiring. The site visualizes the underlying audit data alongside the prose so readers can see the bias gap, not just read about it.",
      "Sections: The Issue · Effects · Causes · My Research · Solutions · Works Cited.",
    ],
    tech: ["HTML/CSS/JS scrollytelling", "Custom data visualizations", "GitHub Pages"],
  },
  {
    slug: "wordle",
    title: "Wordle Solver",
    description:
      "Algorithmic Wordle solver that ranks guesses by information gain. Pure browser-side JavaScript.",
    href: "https://leoniscooler.github.io/wordlesolver/",
    image: "/cards/card_wordle_solver.png",
    tag: "Live demo",
    story: [
      "A Wordle helper that ranks every possible guess by expected information gain — the same entropy-based approach 3Blue1Brown popularised for Wordle. Type in your feedback so far (greens, yellows, grays) and the solver returns the guess that minimises remaining possibilities in the worst case.",
      "Implemented as pure browser JavaScript with no server. The full English word list ships as a static asset; the entropy calculation runs in the user's browser.",
    ],
    tech: ["JavaScript (vanilla)", "Information theory / entropy ranking", "GitHub Pages static hosting"],
  },
  {
    slug: "docs",
    title: "Docs",
    description: "Static documentation hub for technical writeups across my projects.",
    href: "https://leoniscooler.github.io/docs/",
    image: "/cards/card_ai_enhanced_docs.png",
    tag: "Live site",
    story: [
      "A static documentation site where I keep long-form technical writeups — methodology notes, code walkthroughs, experiment results — that don't fit neatly into a single project README.",
    ],
    tech: ["Static site generator", "GitHub Pages"],
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
      "Browser basketball mini-game — flick to shoot, time your release for the score before the clock runs out.",
    href: "https://leoniscooler.github.io/basket/",
    image: "/cards/card_basket.png",
    tag: "Live demo",
  },
  {
    slug: "blackjoy",
    title: "Black Joy",
    description: "Themed card-game variant on the blackjack rule set.",
    href: "https://leoniscooler.github.io/blackjoy/",
    image: "/cards/card_blackjoy.png",
    tag: "Live demo",
  },
  {
    slug: "ski",
    title: "Leonski",
    description:
      "Endless ski-down game. Dodge trees, build speed, see how long you can stay alive.",
    href: "https://leoniscooler.github.io/ski/",
    image: "/cards/card_ski.png",
    tag: "Live demo",
  },
  {
    slug: "coconut",
    title: "Coconut Simulator",
    description: "Idle clicker — every tap shakes more coconuts from the tree.",
    href: "https://leoniscooler.github.io/coconut/",
    image: "/cards/card_coconut.png",
    tag: "Live demo",
  },
  {
    slug: "car",
    title: "Neon Velocity",
    description: "Top-down arcade racer with a neon aesthetic. Steer the corners, don't crash.",
    href: "https://leoniscooler.github.io/car/",
    image: "/cards/card_car.png",
    tag: "Live demo",
  },
  {
    slug: "clash",
    title: "Clash Royale",
    description:
      "Tower-defense card game in the Clash Royale mold — deploy troops, defend your tower, take down the opponent's.",
    href: "https://leoniscooler.github.io/clash/",
    image: "/cards/card_clash.png",
    tag: "Live demo",
  },
  {
    slug: "imposter",
    title: "Imposter Game",
    description: "Among Us-style social deduction game playable in a single browser session.",
    href: "https://leoniscooler.github.io/imposter/",
    image: "/cards/card_imposter.png",
    tag: "Live demo",
  },
  {
    slug: "slope",
    title: "Slope",
    description:
      "Steer a rolling ball down a procedurally-extending 3D slope. Avoid obstacles, accumulate speed.",
    href: "https://leoniscooler.github.io/slope/",
    image: "/cards/card_slope.png",
    tag: "Live demo",
  },
  {
    slug: "platformer",
    title: "Leon's Platformer",
    description:
      "Side-scrolling 2D platformer with jump, double-jump, and hand-designed levels.",
    href: "https://leoniscooler.github.io/platformer/",
    image: "/cards/card_platformer.png",
    tag: "Live demo",
  },
  {
    slug: "wordle-game",
    title: "Leon's Wordle",
    description:
      "Browser Wordle clone — guess the five-letter word in six tries. (Different from the AI Wordle Solver under AI projects.)",
    href: "https://leoniscooler.github.io/wordle/",
    image: "/cards/card_wordle-game.png",
    tag: "Live demo",
  },
  {
    slug: "blackjack",
    title: "Blackjack Game",
    description: "Single-player blackjack against a simulated dealer — hit, stand, double down.",
    href: "https://leoniscooler.github.io/blackjack/",
    image: "/cards/card_blackjack.png",
    tag: "Live demo",
  },
  {
    slug: "tennis",
    title: "Tennis",
    description: "Two-player tennis on one keyboard. Left and right paddles bounce the ball back and forth.",
    href: "https://leoniscooler.github.io/tennis/",
    image: "/cards/card_tennis.png",
    tag: "Live demo",
  },
  {
    slug: "leon-2048",
    title: "LEON 2048",
    description: "2048 number-merging puzzle reskinned with my own tile art.",
    href: "https://leoniscooler.github.io/LEON/",
    image: "/cards/card_leon-2048.png",
    tag: "Live demo",
  },
  {
    slug: "tetris",
    title: "Tetris",
    description: "Browser Tetris — falling tetrominoes, line clears, speed ramps up as you progress.",
    href: "https://leoniscooler.github.io/Tetris/",
    image: "/cards/card_tetris.png",
    tag: "Live demo",
  },
  {
    slug: "pong",
    title: "Pong",
    description: "Classic Pong. Two paddles, one ball, first to ten.",
    href: "https://leoniscooler.github.io/pong/",
    image: "/cards/card_pong.png",
    tag: "Live demo",
  },
  {
    slug: "snake",
    title: "Snake",
    description: "Classic Snake — eat food, grow longer, avoid your own tail.",
    href: "https://leoniscooler.github.io/snake/",
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
      "Interactive polar coordinate grapher. Plot multiple curves like r = 2 + 3·sin(θ) or r = 4·cos(2θ) and watch them render on a polar axis with π-labelled gridlines.",
    href: "https://leoniscooler.github.io/polar/",
    image: "/cards/card_polar.png",
    tag: "Live demo",
  },
  {
    slug: "euler",
    title: "Euler's Method Solver",
    description:
      "Numerical solver that approximates first-order ODEs using Euler's method. Adjust step size to see how accuracy changes with step count.",
    href: "https://leoniscooler.github.io/euler/",
    image: "/cards/card_euler.png",
    tag: "Live demo",
  },
  {
    slug: "calculus",
    title: "Calculus Solver",
    description:
      "Single-page calculus tool covering derivatives, integrals, and limits — enter a function and get the symbolic result plus an auto-generated graph.",
    href: "https://leoniscooler.github.io/calculus/",
    image: "/cards/card_calculus.png",
    tag: "Live demo",
  },
  {
    slug: "polynomial",
    title: "Polynomial Solver",
    description:
      "Roots-and-factorisation helper for polynomial equations. Useful for cross-checking algebra homework before submitting it.",
    href: "https://leoniscooler.github.io/polynomial/",
    image: "/cards/card_polynomial.png",
    tag: "Live demo",
  },
  {
    slug: "unit-circle",
    title: "Unit Circle",
    description:
      "Interactive unit circle reference. Click around the circle to see exact sine, cosine, and tangent values at the standard angles.",
    href: "https://leoniscooler.github.io/unit-circle/",
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
      "Interactive simulation of the Doppler effect — adjust source velocity and observer position to see how perceived frequency shifts as the source approaches or recedes.",
    href: "https://leoniscooler.github.io/doppler/",
    image: "/cards/card_doppler.png",
    tag: "Live demo",
  },
  {
    slug: "circuit",
    title: "Circuit Builder",
    description:
      "Drag-and-drop circuit playground. Wire up resistors, capacitors, and voltage sources, then watch current and voltage values update as you change the topology.",
    href: "https://leoniscooler.github.io/circuit/",
    image: "/cards/card_circuit.png",
    tag: "Live demo",
  },
  {
    slug: "kinetic-theory",
    title: "Kinetic Theory Simulator",
    description:
      "2D gas-particle simulator demonstrating kinetic theory: change temperature or particle count and see velocity distributions, mean kinetic energy, and collision behavior shift in real time.",
    href: "https://leoniscooler.github.io/kinetic-theory/",
    image: "/cards/card_kinetic-theory.png",
    tag: "Live demo",
  },
];

physicsProjects.forEach((p) => {
  p.detailHref = `/physics/${p.slug}`;
});
