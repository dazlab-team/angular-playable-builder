# angular-playable-builder
Builds Facebook Playable Ad source file from the Angular app sources.

## Requirements

 - Angular CLI v11

## Installation

```
npm i -D @dazlab-team/angular-playable-builder
```

then edit `angular.json`, replace default builder:

```
"builder": "@angular-devkit/build-angular:browser"
```

with the new one:

```
"builder": "@dazlab-team/angular-playable-builder:playable"
```

and run `ng build --prod`.

Playable file will be located in `dist/<your-project-name>/index.html`.
