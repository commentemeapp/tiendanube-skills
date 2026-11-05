// Verifica las skills de skills/<nombre>/SKILL.md: frontmatter, secciones y la sección
// Reference. Dos tipos de fuente:
//
//   - páginas de nuvemshop.dev, citadas por la URL de su versión Markdown
//     (https://nuvemshop.dev/en-US/<ruta>.md): tienen que responder 200;
//   - archivos de los repositorios MIT de data/fonte.json, citados como `repo/ruta` con el
//     enlace a GitHub en el commit fijado en la misma línea: tienen que existir en ese commit.
//
// Imprime una línea por resultado, con el prefijo "ok:", "mal:" o "aviso:", y la lee
// scripts/verificar.sh. Sale con 1 si hubo algún "mal:".
import fs from "node:fs";
import path from "node:path";

const raiz = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const fonte = JSON.parse(fs.readFileSync(path.join(raiz, "data/fonte.json"), "utf8"));
const porRepo = Object.fromEntries(fonte.fuentes.map((f) => [f.repo, f]));

let fallo = false;
const ok = (m) => console.log(`ok:${m}`);
const mal = (m) => {
	console.log(`mal:${m}`);
	fallo = true;
};
const aviso = (m) => console.log(`aviso:${m}`);

const SECCIONES = [
	"When this skill applies",
	"Decision rules",
	"Hard constraints",
	"Preferred pattern",
	"Common failure modes",
	"Review checklist",
	"Reference"
];
const PREFIJO = "tiendanube-";
const PAGINA = /https:\/\/nuvemshop\.dev\/en-US\/[A-Za-z0-9_\-/.]+\.md/g;
const repos = Object.keys(porRepo)
	.map((r) => r.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
	.join("|");
const RUTA = new RegExp("`((" + repos + ")\\/[^`\\s]+)`", "g");

const githubDe = (ruta) => {
	const [repo, ...resto] = ruta.split("/");
	return `${porRepo[repo].url}/blob/${porRepo[repo].commit}/${resto.join("/")}`;
};
const rawDe = (ruta) => {
	const [repo, ...resto] = ruta.split("/");
	const dueño = porRepo[repo].url.split("/")[3];
	return `https://raw.githubusercontent.com/${dueño}/${repo}/${porRepo[repo].commit}/${resto.join("/")}`;
};

const dirSkills = path.join(raiz, "skills");
const nombres = fs.existsSync(dirSkills)
	? fs.readdirSync(dirSkills).filter((n) => fs.statSync(path.join(dirSkills, n)).isDirectory())
	: [];
if (nombres.length === 0) {
	mal("no hay skills en skills/");
	process.exit(1);
}

const paginas = new Map(); // url -> [skills]
const rutas = new Map(); // ruta -> [skills]
const anotar = (mapa, clave, skill) => {
	if (!mapa.has(clave)) mapa.set(clave, []);
	mapa.get(clave).push(skill);
};
let skillsMal = 0;
for (const nombre of nombres.sort()) {
	const archivo = path.join(dirSkills, nombre, "SKILL.md");
	const errores = [];
	if (!fs.existsSync(archivo)) {
		mal(`${nombre}: falta SKILL.md`);
		skillsMal++;
		continue;
	}
	const texto = fs.readFileSync(archivo, "utf8");
	const fm = texto.match(/^---\n([\s\S]*?)\n---\n/);
	if (!fm) errores.push("sin frontmatter");
	else {
		const lineas = fm[1].split("\n");
		const campo = (k) => {
			const l = lineas.find((x) => x.startsWith(k + ":"));
			return l ? l.slice(k.length + 1).trim() : null;
		};
		const n = campo("name");
		if (n !== nombre) errores.push(`name "${n}" distinto de la carpeta`);
		if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(nombre)) errores.push("la carpeta no está en kebab-case");
		if (!nombre.startsWith(PREFIJO)) errores.push(`sin el prefijo ${PREFIJO}`);
		let d = campo("description");
		if (!d) errores.push("sin description");
		else {
			if (/^".*"$/.test(d)) d = JSON.parse(d);
			if ([...d].length > 1024) errores.push(`description de ${[...d].length} caracteres (máximo 1024)`);
			if (!d.startsWith("Apply when")) errores.push('la description no empieza por "Apply when"');
		}
		if (campo("license") !== "MIT") errores.push("license distinta de MIT");
		if (!campo("compatibility")) errores.push("sin compatibility");
	}
	for (const s of SECCIONES) {
		if (!new RegExp(`^## ${s}$`, "m").test(texto)) errores.push(`falta la sección "## ${s}"`);
	}
	const ref = texto.split(/^## Reference$/m)[1];
	if (ref !== undefined) {
		const cuerpo = ref.split(/^## /m)[0];
		let n = 0;
		for (const linea of cuerpo.split("\n")) {
			for (const m of linea.matchAll(PAGINA)) {
				n++;
				anotar(paginas, m[0], nombre);
			}
			for (const m of linea.matchAll(RUTA)) {
				n++;
				const url = githubDe(m[1]);
				if (!linea.includes(`(${url})`)) errores.push(`${m[1]}: falta el enlace ${url} en la misma línea`);
				anotar(rutas, m[1], nombre);
			}
		}
		if (n === 0) errores.push("la sección Reference no cita ninguna fuente");
	}
	const lineas = texto.split("\n").length;
	if (lineas < 120 || lineas > 350) aviso(`${nombre}: ${lineas} líneas (se espera entre 150 y 300)`);
	if (errores.length) {
		mal(`${nombre}: ${errores.join("; ")}`);
		skillsMal++;
	}
}
if (skillsMal === 0) ok(`${nombres.length} skills con frontmatter, secciones y Reference correctos`);

// Las fuentes citadas existen. Una página que no responde 200 o un archivo que no está en
// el commit fijado es una falla; lo que no se pudo consultar, un aviso (falla en el CI).
const faltan = [];
let noVerificadas = 0;
const espera = (ms) => new Promise((r) => setTimeout(r, ms));
const consultar = async ([url, cita]) => {
	// Hasta tres intentos: el sitio limita la frecuencia y a veces responde 429 o 5xx.
	for (let intento = 1; intento <= 3; intento++) {
		try {
			const r = await fetch(url, {
				method: "HEAD",
				redirect: "manual",
				headers: { "User-Agent": "tiendanube-skills-gate" },
				signal: AbortSignal.timeout(15000)
			});
			if (r.status === 404 || (r.status >= 300 && r.status < 400)) {
				faltan.push(`${cita} (${r.status})`);
				return;
			}
			if (r.ok) return;
		} catch {
			// sin respuesta: se reintenta
		}
		await espera(1000 * intento);
	}
	noVerificadas++;
};
const cola = [...[...paginas.keys()].map((u) => [u, u]), ...[...rutas.keys()].map((r) => [rawDe(r), r])];
const total = cola.length;
await Promise.all(
	Array.from({ length: 3 }, async () => {
		while (cola.length) await consultar(cola.shift());
	})
);
for (const f of faltan) mal(`fuente que no existe: ${f}`);
if (noVerificadas) {
	const m = `${noVerificadas} de ${total} fuentes sin respuesta (no verificado)`;
	if (process.env.CI === "true") mal(m);
	else aviso(m);
}
if (!faltan.length && !noVerificadas)
	ok(`las ${total} fuentes citadas existen (${paginas.size} páginas de nuvemshop.dev, ${rutas.size} archivos fijados)`);

process.exit(fallo ? 1 : 0);
