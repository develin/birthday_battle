# 🎂 Birthday Battle

A simple scorekeeper for kids' birthday party games. Set up the players, run the games, and watch the scoreboard.

## Getting started

Open `src/index.html` in any modern browser. No install, server or internet connection needed.

Scores are saved in the browser, so refreshing the page won't lose them.

It's designed to be shown on a TV (720p or higher): put the browser in full screen (F11) and the screens scale to fit.

The app's interface is in German.

## Features

- **Kinder (players):** choose how many kids are playing, enter their names and pick an avatar
- **Spiele (game list):** the games for the party, saved in the browser. Add your own, switch off games the kids don't like, or delete them
- **Spielen (play):** pick a game from the list ("Neues Spiel"), choose who's playing and award 🥇 🥈 🥉 or custom points
- **🎲 Zufall (Glücksrad):** a spinning wheel with every game that's switched on. It turns slowly for 2 seconds, then fast; a kid presses "Stopp!" and the wheel picks the next game. Each time a game is played its slice halves, until every game has had a turn; then everything counts one round less. A new party starts all games from zero
- **Podium:** after each game, a "Sieger" announcement and a podium for the top three, with everyone else on the ground
- **Scoreboard:** everyone ranked by total points, plus a history of games played

## Project structure

```
src/
  index.html   page markup
  styles.css   styling
  app.js       app logic and saved data
  fonts/       Bungee and Baloo 2 (SIL Open Font License), bundled for offline use
```
