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
    href: "https://avalancheprediction.streamlit.app/",
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
    href: "https://aiartdetection.streamlit.app/",
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
  {
    slug: "chatgpt",
    title: "ChatGPT Interface",
    description: "Lightweight ChatGPT-style chat UI built on the OpenAI API.",
    href: "https://leoniscooler.github.io/chatgpt/",
    image: "/cards/card_chatGPT.png",
    tag: "Live demo",
    story: [
      "A minimal ChatGPT-style chat interface I built to learn how the OpenAI Chat Completions API actually works — message threading, streaming responses, system prompts, and the rest. Hosted on GitHub Pages with the API key supplied client-side (browser-only, no server).",
    ],
    tech: ["JavaScript", "OpenAI Chat Completions API", "GitHub Pages"],
  },
];

// Mark AI projects as having detail pages
aiProjects.forEach((p) => {
  p.detailHref = `/ai/${p.slug}`;
});

export const gameProjects: Project[] = Array.from({ length: 18 }, (_, i) => ({
  slug: `game-${i + 1}`,
  title: `Game Project ${i + 1}`,
  description: "Project details coming soon.",
  href: "#",
}));

export const mathProjects: Project[] = Array.from({ length: 3 }, (_, i) => ({
  slug: `math-${i + 1}`,
  title: `Math Project ${i + 1}`,
  description: "Project details coming soon.",
  href: "#",
}));

export const physicsProjects: Project[] = Array.from({ length: 2 }, (_, i) => ({
  slug: `physics-${i + 1}`,
  title: `Physics Project ${i + 1}`,
  description: "Project details coming soon.",
  href: "#",
}));
