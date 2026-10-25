// Configuración de cada tipo de reporte: UN solo formulario que se arma según el tipo.
// Para cambiar preguntas u opciones basta con editar este archivo.
export type Tipo = 'incendio' | 'accidente' | 'gas' | 'fauna' | 'infraestructura' | 'otra';

export interface Pregunta {
  clave: string; texto: string; multiple?: boolean; opciones: [string, string][];
}
export interface Formulario {
  tipo: Tipo; nombre: string; titulo: string; color: string; tinte: string;
  aviso?: string;                 // aviso de seguridad arriba del formulario
  checklist?: string[];           // pasos que se deben hacer ANTES (fuga de gas)
  preguntas: Pregunta[];
  sugerencias?: string[];         // chips que llenan la descripción (otra emergencia)
  placeholder: string;
  consejo: string;                // "mientras llega la unidad"
}

const SI_NO: [string, string][] = [['si', 'Sí'], ['no', 'No'], ['no_se', 'No sé']];

export const FORMULARIOS: Record<Tipo, Formulario> = {
  incendio: {
    tipo: 'incendio', nombre: 'Incendio', titulo: 'Reportar incendio', color: '#B3261E', tinte: '#FBE3E1',
    aviso: 'Aléjate del humo y no uses elevadores. Si estás dentro, sal agachado y cierra puertas al salir.',
    preguntas: [
      { clave: 'lugar', texto: '¿Qué se está quemando?', opciones: [['casa', 'Casa'], ['comercio', 'Comercio'], ['pastizal', 'Pastizal o cerro'], ['vehiculo', 'Vehículo'], ['basura', 'Basura'], ['otro', 'Otro']] },
      { clave: 'personas_dentro', texto: '¿Hay personas dentro?', opciones: SI_NO },
      { clave: 'tamano', texto: '¿Qué tan grande es?', opciones: [['pequeno', 'Pequeño'], ['mediano', 'Mediano'], ['grande', 'Grande']] },
    ],
    placeholder: 'Ej. Sale humo negro de una casa de dos pisos',
    consejo: 'Mantente a distancia segura y lejos del humo. No regreses por objetos. Deja libre el paso para la unidad.',
  },
  accidente: {
    tipo: 'accidente', nombre: 'Accidente', titulo: 'Reportar accidente', color: '#2A3A8C', tinte: '#E2E6F5',
    preguntas: [
      { clave: 'tipo_accidente', texto: '¿Qué pasó?', opciones: [['choque', 'Choque'], ['volcadura', 'Volcadura'], ['atropellamiento', 'Atropellamiento'], ['motocicleta', 'Motocicleta'], ['atrapado', 'Persona atrapada']] },
      { clave: 'lesionados', texto: '¿Hay personas lesionadas?', opciones: SI_NO },
    ],
    placeholder: 'Ej. Choque de dos autos, hay una persona atrapada',
    consejo: 'Mantente en un lugar seguro, enciende las luces intermitentes y no muevas a las personas lesionadas.',
  },
  gas: {
    tipo: 'gas', nombre: 'Fuga de gas', titulo: 'Reportar fuga de gas', color: '#A04E00', tinte: '#FDEBD3',
    checklist: ['No prendas ni apagues luces', 'No uses cerillos, encendedores ni el timbre', 'Abre puertas y ventanas',
      'Cierra la llave del gas si puedes', 'Sal del lugar y reporta desde afuera'],
    preguntas: [
      { clave: 'origen', texto: '¿De dónde viene?', opciones: [['cilindro', 'Cilindro'], ['estacionario', 'Tanque estacionario'], ['tuberia', 'Tubería'], ['pipa', 'Pipa'], ['calle', 'Olor en la calle']] },
      { clave: 'intensidad', texto: '¿Qué tan fuerte es el olor?', opciones: [['leve', 'Leve'], ['fuerte', 'Fuerte'], ['muy_fuerte', 'Muy fuerte']] },
      { clave: 'llave_cerrada', texto: '¿Pudiste cerrar la llave?', opciones: SI_NO },
    ],
    placeholder: 'Ej. Huele muy fuerte a gas en el patio',
    consejo: 'Quédate afuera, lejos del olor. No regreses a cerrar nada ni uses el celular dentro del lugar.',
  },
  fauna: {
    tipo: 'fauna', nombre: 'Control de fauna', titulo: 'Control de fauna', color: '#1E6B34', tinte: '#DFF0E2',
    aviso: 'No lo toques ni intentes atraparlo. Aleja a niños y mascotas.',
    preguntas: [
      { clave: 'animal', texto: '¿Qué animal es?', opciones: [['abejas', 'Abejas o avispas'], ['serpiente', 'Serpiente'], ['alacran', 'Alacrán'], ['perro', 'Perro agresivo'], ['atrapado', 'Animal atrapado'], ['silvestre', 'Otro silvestre']] },
      { clave: 'donde', texto: '¿Dónde está?', opciones: [['casa', 'Dentro de casa'], ['patio', 'Patio o azotea'], ['calle', 'En la calle'], ['arbol', 'En un árbol'], ['otro', 'Otro lugar']] },
      { clave: 'picado', texto: '¿Alguien fue picado o mordido?', opciones: SI_NO },
    ],
    placeholder: 'Ej. Enjambre grande en la ventana del segundo piso',
    consejo: 'Mantén distancia y cierra puertas para que el animal no se mueva a otras áreas. Si alguien fue picado, llama al 911.',
  },
  infraestructura: {
    tipo: 'infraestructura', nombre: 'Caída de infraestructura', titulo: 'Caída de infraestructura', color: '#5B2A86', tinte: '#ECE1F3',
    aviso: 'Los cables caídos pueden tener corriente: no te acerques ni los toques.',
    preguntas: [
      { clave: 'objeto', texto: '¿Qué se cayó?', opciones: [['arbol', 'Árbol'], ['poste', 'Poste o cables'], ['barda', 'Barda'], ['derrumbe', 'Derrumbe'], ['socavon', 'Socavón'], ['fachada', 'Fachada']] },
      { clave: 'riesgos', texto: 'Marca lo que aplique', multiple: true, opciones: [['cables', 'Hay cables caídos'], ['bloquea', 'Bloquea la calle'], ['atrapadas', 'Personas atrapadas'], ['vehiculos', 'Dañó vehículos']] },
    ],
    placeholder: 'Ej. Cayó un árbol sobre un auto, bloquea un carril',
    consejo: 'Aléjate de la zona y avisa a otras personas. No te acerques a cables ni muevas escombros.',
  },
  otra: {
    tipo: 'otra', nombre: 'Otra emergencia', titulo: 'Otra emergencia', color: '#3D3D3D', tinte: '#ECECEC',
    preguntas: [],
    sugerencias: ['Inundación', 'Rescate', 'Persona en riesgo', 'Olor químico', 'Corto circuito'],
    placeholder: 'Describe qué está pasando y si hay personas en riesgo',
    consejo: 'Mantente en un lugar seguro. Si hay personas en riesgo inmediato, llama también al 911.',
  },
};
export const ORDEN_TIPOS: Tipo[] = ['incendio', 'accidente', 'gas', 'fauna', 'infraestructura', 'otra'];

export const MOTIVOS_REVISION: [string, string][] = [
  ['gas', 'Instalación de gas'], ['electrica', 'Instalación eléctrica'], ['extintores', 'Extintores'],
  ['plan_pc', 'Plan de protección civil'], ['evento', 'Evento o espectáculo'], ['otro', 'Otro'],
];
export const INMUEBLES: [string, string][] = [['casa', 'Casa'], ['negocio', 'Negocio'], ['escuela', 'Escuela'], ['oficina', 'Oficina'], ['otro', 'Otro']];

/** Convierte las respuestas en texto legible para el bot y el panel. */
export function resumen(f: Formulario, valores: Record<string, string | string[]>): string[] {
  const l: string[] = [];
  for (const p of f.preguntas) {
    const v = valores[p.clave];
    if (!v || (Array.isArray(v) && !v.length)) continue;
    const t = (Array.isArray(v) ? v : [v]).map((x) => p.opciones.find((o) => o[0] === x)?.[1] ?? x).join(', ');
    l.push(p.multiple ? t : `${p.texto.replace(/[¿?]/g, '')}: ${t}`);
  }
  return l;
}
