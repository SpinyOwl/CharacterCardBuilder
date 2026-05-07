import { Component, signal } from '@angular/core';

@Component({
  selector: 'app-root',
  template: `
    <h1>Hello, {{ title() }}</h1>
    <p>Congratulations! Your app is running. 🎉</p>
    
    
  `,
  standalone: false,
  styles: []
})
export class App {
  protected readonly title = signal('character-card-builder');
}
