import { mount } from 'svelte';
import Panel from './Panel.svelte';
import './panel.css';

mount(Panel, { target: document.getElementById('app')! });
