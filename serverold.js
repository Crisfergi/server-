require('dotenv').config();
const express = require('express');
const { Client } = require('pg');
const cors = require('cors');
const bcrypt = require('bcryptjs');

const jwt = require('jsonwebtoken');
const JWT_SECRET = process.env.JWT_SECRET;
const app = express();
app.use(cors());
app.use(express.json());

// Configuración de la base de datos PostgreSQL
const client = new Client({
    user: process.env.DB_USER,
    host:  process.env.DB_HOST,
    database:  process.env.DB_DATABASE,
    password:  process.env.DB_PASSWORD,
    port:  process.env.DB_PORT,
});

// Conectar a PostgreSQL
client.connect()
    .then(() => console.log("Conectado a PostgreSQL"))
    .catch(err => console.error('Error al conectar', err.stack));

    client.on('error', (err) => {
        console.error('Se ha perdido la conexión a PostgreSQL:', err);
        client.connect()
            .then(() => console.log('Reconectado a PostgreSQL'))
            .catch(err => console.error('Error al reconectar', err.stack));
    });
// Middleware para verificar el JWT
const authenticateToken = (req, res, next) => {
    // El token puede venir en los headers como 'Authorization: Bearer <token>'
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1]; // Obtenemos el token

    if (!token) {
        return res.status(401).json({ message: 'Acceso denegado. No se ha proporcionado un token' });
    }

    // Verificar el token
    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) {
            return res.status(403).json({ message: 'Token no válido o expirado' });
        }

        // Guardar la información del usuario extraída del token en req.user
        req.user = user;
        next(); // Continuar con la siguiente función en la ruta
    });
};

///API

// Endpoint para obtener datos
app.get('/datos', async (req, res) => {
    try {
        const result = await client.query('SELECT * FROM sictax_tramitesdb.asignacion');
        res.json(result.rows);
    } catch (error) {
        console.error(error);
        res.status(500).send('Error en la consulta a la base de datos');
    }
});



//Endpoint Ruta de login
app.post('/login', async (req, res) => {
    const { login_name, password } = req.body;

    try {
        // Buscar al usuario en la base de datos
        const result = await client.query('SELECT password,login_name, idusuario, primer_nombre, primer_apellido, correo_electronico, hashverificacionusuario, cargo FROM sictax_control_usuario.usuario WHERE login_name = $1', [login_name]);
        
        if (result.rows.length === 0) {
            return res.status(400).json({ success: false, message: 'Usuario no encontrado' });
        }
        const user = result.rows[0];
        const hashedPassword = result.rows[0].password;

        // Comparar la contraseña ingresada con el hash almacenado
        const isMatch = await bcrypt.compare(password, hashedPassword);

        if (isMatch) {

             // Si la contraseña es correcta, generar el JWT
             const token = jwt.sign(
                { login_name: user.login_name, primer_nombre: user.primer_nombre, cargo: user.cargo }, // Payload
                JWT_SECRET,  // Clave secreta para firmar el token
                { expiresIn: '1d' } // El token expirará en 1 hora
            );


            return res.json({
                success: true,
                message: 'Login exitoso',
                token: token,
                user: {
                    
                    primer_nombre: user.primer_nombre,
                    idusuario:user.idusuario,
                    primer_apellido: user.primer_apellido,
                    correo_electronico: user.correo_electronico,
                    hashverificacionusuario: user.hashverificacionusuario,
                    cargo: user.cargo
                }
            });
        } else {
            return res.status(400).json({ success: false, message: 'Contraseña incorrecta' });
        }
    } catch (error) {
        console.error(error);
        return res.status(500).json({ success: false, message: 'Error del servidor' });
    }
});



// // Rutas protegidas con el middleware authenticateToken busca las asignaciones 
app.post('/datosasignadosold', authenticateToken, async (req, res) => {
    const { usuarioasignado } = req.body;

    // Consulta con los LEFT JOINs
    let query = `
        SELECT t.*, e.nombre as etapa, p.*, 
               d.dispname as departamentoname, m.dispname as municipioname, 
               c.idconstruccion, c.tipo_construccion, c.anio_construccion,c.avaluo_construccion, 
               u.idunidadconstruccion , u.tipo_construccion, u.anio_construccion,extd.*, tr.*
        FROM sictax_tramitesdb.asignacion t
        LEFT JOIN sictax_tramitesdb.etapas e ON t.etapa_id = e.id
        LEFT JOIN sictax_data_temporal.lc_predio_t p ON t.idpredio = p.idpredio
        LEFT JOIN sictax_data_temporal.lc_terreno_t tr ON tr.idpredio = p.idpredio
        LEFT JOIN sictax_data_temporal.extdireccion_t extd ON t.idpredio = extd.lc_predio_direccion
        LEFT JOIN sictax_dominios.st_departamentos d ON p.departamento = d.itfcode::text
        LEFT JOIN sictax_dominios.st_municipios m ON p.municipio = m.itfcode::text
        LEFT JOIN sictax_data_temporal.lc_construccion_t c ON p.idpredio = c.idpredio
        LEFT JOIN sictax_data_temporal.lc_unidadconstruccion_t u ON c.idconstruccion = u.lc_construccion
        WHERE t.etapa_id = 13
    `;
    
    let queryParams = [];
    if (usuarioasignado) {
        query += " AND t.usuario_asignado = $1";
        queryParams.push(parseInt(usuarioasignado, 10));
    }
    
    try {
        const result = await client.query(query, queryParams);
        
        if (result.rows.length > 0) {
            let prediosMap = {};
    
            result.rows.forEach(row => {
                const idPredio = row.idpredio;
                const idconstruccion = row.idconstruccion;
    
                // Inicializa el predio si no existe en el mapa
                if (!prediosMap[idPredio]) {
                    prediosMap[idPredio] = {
                        idpredio: row.idpredio || null,
                        idasignacion: row.idasignacion || null,
                        etapa_id: row.etapa_id || null,
                        usuario_asigna: row.usuario_asigna || null,
                        fecha_asignado: row.fecha_asignado || null,
                        usuario_asignado: row.usuario_asignado || null,
                        usuario_editor: row.usuario_editor || null,
                        fecha_desasignado: row.fecha_desasignado || null,
                        numero_predial: row.numero_predial || null,
                        etapa: row.etapa || null,
                        departamento: row.departamento || null,
                        municipio: row.municipio || null,
                        id_operacion: row.id_operacion || null,
                        tiene_fmi: row.tiene_fmi || null,
                        codigo_orip: row.codigo_orip || null,
                        matricula_inmobiliaria: row.matricula_inmobiliaria || null,
                        numero_predial_anterior: row.numero_predial_anterior || null,
                        nupre: row.nupre || null,
                        avaluo_catastral: row.avaluo_catastral || null,
                        tipo: row.tipo || null,
                        condicion_predio: row.condicion_predio || null,
                        departamentoname: row.departamentoname || null,
                        municipioname: row.municipioname || null,
                        destinacion_economica: row.destinacion_economica || null,

                        tipo_direccion: row.tipo_direccion || null,
                        es_direccion_principal: row.es_direccion_principal || null,
                        sector_predio: row.sector_predio || null,
                        sector_ciudad: row.sector_ciudad || null,
                        codigo_postal: row.codigo_postal || null,
                        clase_via_principal: row.clase_via_principal || null,
                        valor_via_principal: row.valor_via_principal || null,
                        letra_via_principal: row.letra_via_principal || null,
                        valor_via_generadora: row. valor_via_generadora || null,
                        letra_via_generadora: row.letra_via_generadora || null,
                        numero_predio: row.numero_predio || null,
                        complemento: row.complemento || null,
                        direccion_completa: row.direccion_completa || null,
                        direcciones:[],
                        construccion: [],
                        unidadconstruccion: []
                    };
                }


                // Agregar direcciones si existen

                if (row.idconstruccion) {
                    prediosMap[idPredio].construccion.push({
                        idconstruccion: row.idconstruccion || null,
                        tipo_construccion: row.tipo_construccion || null,
                        anio_construccion: row.anio_construccion || null,
                        avaluo_construccion: row.avaluo_construccion || null
                    });
                }
    
                // Agregar construcciones si existen
                if (row.idconstruccion) {
                    prediosMap[idPredio].construccion.push({
                        idconstruccion: row.idconstruccion || null,
                        tipo_construccion: row.tipo_construccion || null,
                        anio_construccion: row.anio_construccion || null,
                        avaluo_construccion: row.avaluo_construccion || null
                    });
                }
    
                // Agregar unidadconstrucciones si existen
                if (row.idunidadconstruccion) {
                    // Revisa que el id de construcción esté inicializado
                    if (!prediosMap[idPredio].unidadconstruccion) {
                        prediosMap[idPredio].unidadconstruccion = [];
                    }
                    prediosMap[idPredio].unidadconstruccion.push({
                        idunidadconstruccion: row.idunidadconstruccion || null,
                        tipo_construccion: row.tipo_construccion || null,
                        anio_construccion: row.anio_construccion || null
                    });
                }
            });
    
            // Convertir el mapa de predios a un array
            const prediosArray = Object.values(prediosMap);
    
            return res.json({
                success: true,
                message: 'Datos encontrados',
                datos: prediosArray
            });
        } else {
            return res.json({
                success: false,
                message: 'No se encontraron datos'
            });
        }
    } catch (error) {
        console.error(error);
        return res.status(500).json({
            success: false,
            message: 'Error al ejecutar la consulta'
        });
    }
});


// Endpoint para obtener catálogos de varias tablas
app.get('/catalogos',authenticateToken, async (req, res) => {
    try {
        
        const departamentosPromise = client.query('SELECT * FROM sictax_dominios.st_departamentos');
        const municipiosPromise = client.query('SELECT * FROM sictax_dominios.st_municipios');
        const predioTipoPromise = client.query('SELECT * FROM sictax_dominios.lc_prediotipo');
        const destinoEconomicoPromise = client.query('SELECT * FROM sictax_dominios.lc_destinacioneconomicatipo');
        const condicionPredioPromise = client.query('SELECT * FROM sictax_dominios.lc_condicionprediotipo');
        const claseViaPrincipalPromise = client.query('SELECT * FROM sictax_dominios.extdireccion_clase_via_principal');
        const sectorCiudadPromise = client.query('SELECT * FROM sictax_dominios.extdireccion_sector_ciudad');
        const sectorPredioPromise = client.query('SELECT * FROM sictax_dominios.extdireccion_sector_predio');
        const tipoDireccionPromise = client.query('SELECT * FROM sictax_dominios.extdireccion_tipo_direccion');
        const construcciontipoPromise = client.query('SELECT * FROM sictax_dominios.lc_construcciontipo');
        const dominioconstrucciontipoPromise = client.query('SELECT * FROM sictax_dominios.lc_dominioconstrucciontipo');
        const unidadconstrucciontipoPromise = client.query('SELECT * FROM sictax_dominios.gc_unidadconstrucciontipo');
        const construccionplantatipoPromise = client.query('SELECT * FROM sictax_dominios.lc_construccionplantatipo');
        const unidadtipoconstruccionPromise = client.query('SELECT * FROM sictax_dominios.lc_unidadconstrucciontipo');
        const usouconstipoPromise = client.query('SELECT * FROM sictax_dominios.lc_usouconstipo');
        const tipologiatipoPromise = client.query('SELECT * FROM sictax_dominios.lc_tipologiatipo');
        const estadoconservaciontipoPromise = client.query('SELECT * FROM sictax_dominios.lc_estadoconservaciontipo');
        const anexotipoPromise = client.query('SELECT * FROM sictax_dominios.lc_anexotipo');
        // Ejecutar todas las promesas en paralelo
        const [
            departamentosResult,
            municipiosResult,
            predioTipoResult,
            destinoEconomicoResult,
            condicionPredioResult,
            claseViaPrincipalResult,
            sectorCiudadResult,
            sectorPredioResult,
            tipoDireccionResult,
            construcciontipoResult,
            dominioconstrucciontipoResult,
            unidadconstrucciontipoResult,
            construccionplantatipoResult,
            unidadtipoconstruccionResult,
            usouconstipoResult,
            tipologiatipoResult,
            estadoconservaciontipoResult,
            anexotipoResult

        ] = await Promise.all([
            departamentosPromise,
            municipiosPromise,
            predioTipoPromise,
            destinoEconomicoPromise,
            condicionPredioPromise,
            claseViaPrincipalPromise,
            sectorCiudadPromise,
            sectorPredioPromise,
            tipoDireccionPromise,
            construcciontipoPromise,
            dominioconstrucciontipoPromise,
            unidadconstrucciontipoPromise,
            construccionplantatipoPromise,
            unidadtipoconstruccionPromise,
            usouconstipoPromise,
            tipologiatipoPromise,
            estadoconservaciontipoPromise,
            anexotipoPromise
        ]);

        // Devolver los resultados en un solo objeto JSON
        res.json({
            success: true,
            catalogos: {
                departamentos: departamentosResult.rows,
                municipios: municipiosResult.rows,
                predioTipo: predioTipoResult.rows,
                destinoEconomico: destinoEconomicoResult.rows,
                condicionPredio: condicionPredioResult.rows,
                claseViaPrincipal: claseViaPrincipalResult.rows,
                sectorCiudad: sectorCiudadResult.rows,
                sectorPredio: sectorPredioResult.rows,
                tipoDireccion: tipoDireccionResult.rows,
                construcciontipo :construcciontipoResult.rows,
                
                dominioconstrucciontipo: dominioconstrucciontipoResult.rows,
                unidadconstrucciontipo: unidadconstrucciontipoResult.rows,
                construccionplantatipo: construccionplantatipoResult.rows,
                unidadtipoconstruccion: unidadtipoconstruccionResult.rows,
                usouconstipo: usouconstipoResult.rows,
                tipologiatipo: tipologiatipoResult.rows,
                estadoconservaciontipo: estadoconservaciontipoResult.rows,
                anexotipo: anexotipoResult.rows
            }
        });
    } catch (error) {
        console.error('Error al obtener los catálogos:', error);
        res.status(500).json({ success: false, message: 'Error al obtener los catálogos' });
    }
});


// // Rutas protegidas con el middleware authenticateToken busca las asignaciones 
app.post('/datosasignados', authenticateToken, async (req, res) => {
    const { usuarioasignado } = req.body;

    // Comenzar una transacción
    try {
        await client.query('BEGIN'); // Iniciar la transacción

        // Consulta para obtener las asignaciones y contar el total al mismo tiempo
        let query = `
            SELECT t.*, e.nombre as etapa, p.*, 
               d.dispname as departamentoname, m.dispname as municipioname, 
               c.idconstruccion, c.identificador as cons_identificador, c.tipo_construccion as cons_tipo_construccion, ctipo.dispname as cons_tipo_construccionname,
               c.anio_construccion as cons_anio_construccion ,c.avaluo_construccion as cons_avaluo_construccion, c.area_construccion as cons_area_construccion,
               c.tipo_dominio as cons_tipo_dominio, c.numero_pisos as cons_numero_pisos, c.numero_sotanos as cons_numero_sotanos, c.numero_mezanines as cons_numero_mezanines,
               c.numero_semisotanos as cons_numero_semisotanos, c.etiqueta as cons_etiqueta, c.altura as cons_altura, c.observaciones as cons_observaciones,
               u.idunidadconstruccion , u.lc_construccion as uni_idconstruccion, u.identificador as uni_identificador, u.tipo_construccion as uni_tipo_construccion, utipo.dispname as uni_tipo_construccionname, u.anio_construccion as uni_anio_construccion,
               extd.*, tr.*,
               (SELECT COUNT(*) FROM sictax_tramitesdb.asignacion 
               WHERE etapa_id = 13 AND usuario_asignado = $1) as total_asignaciones
            FROM sictax_tramitesdb.asignacion t
            LEFT JOIN sictax_tramitesdb.etapas e ON t.etapa_id = e.id
            LEFT JOIN sictax_data_temporal.lc_predio_t p ON t.idpredio = p.idpredio
            LEFT JOIN sictax_data_temporal.lc_terreno_t tr ON tr.idpredio = p.idpredio
            LEFT JOIN sictax_data_temporal.extdireccion_t extd ON t.idpredio = extd.lc_predio_direccion
            LEFT JOIN sictax_dominios.st_departamentos d ON p.departamento = d.itfcode::text
            LEFT JOIN sictax_dominios.st_municipios m ON p.municipio = m.itfcode::text
            LEFT JOIN sictax_data_temporal.lc_construccion_t c ON p.idpredio = c.idpredio
            LEFT JOIN sictax_dominios.lc_construcciontipo ctipo ON ctipo.itfcode = c.tipo_construccion
            LEFT JOIN sictax_data_temporal.lc_unidadconstruccion_t u ON c.idconstruccion = u.lc_construccion
            LEFT JOIN sictax_dominios.gc_unidadconstrucciontipo utipo ON utipo.itfcode = u.tipo_construccion
            WHERE t.etapa_id = 13
        `;

       
            // Filtrar por usuario asignado si está presente
            if (usuarioasignado) {
                query += " AND t.usuario_asignado = $2";
            }

            // Ejecutar la consulta y obtener resultados
            const result = await client.query(query, [parseInt(usuarioasignado, 10), parseInt(usuarioasignado, 10)]);
            const totalAsignaciones = result.rows[0].total_asignaciones;

        if (result.rows.length > 0) {
            const prediosMap = {};
            const idsAsignacionesDescargadas = [];

            result.rows.forEach(row => {
                const idPredio = row.idpredio;
                const idconstruccion = row.idconstruccion;
                if (!prediosMap[idPredio]) {
                    prediosMap[idPredio] = {
                        idpredio: row.idpredio || null,
                    idasignacion: row.idasignacion || null,
                    iddireccion: row.iddireccion || null,
                    etapa_id: row.etapa_id || null,
                    usuario_asigna: row.usuario_asigna || null,
                    fecha_asignado: row.fecha_asignado || null,
                    usuario_asignado: row.usuario_asignado || null,
                    usuario_editor: row.usuario_editor || null,
                    fecha_desasignado: row.fecha_desasignado || null,
                    numero_predial: row.numero_predial || null,
                    etapa: row.etapa || null,
                    departamento: row.departamento || null,
                    municipio: row.municipio || null,
                    id_operacion: row.id_operacion || null,
                    tiene_fmi: row.tiene_fmi || null,
                    codigo_orip: row.codigo_orip || null,
                    matricula_inmobiliaria: row.matricula_inmobiliaria || null,
                    numero_predial_anterior: row.numero_predial_anterior || null,
                    nupre: row.nupre || null,
                    avaluo_catastral: row.avaluo_catastral || null,
                    tipo: row.tipo || null,
                    condicion_predio: row.condicion_predio || null,
                    departamentoname: row.departamentoname || null,
                    municipioname: row.municipioname || null,
                    destinacion_economica: row.destinacion_economica || null,

                    tipo_direccion: row.tipo_direccion || null,
                    es_direccion_principal: row.es_direccion_principal || null,
                    sector_predio: row.sector_predio || null,
                    sector_ciudad: row.sector_ciudad || null,
                    codigo_postal: row.codigo_postal || null,
                    clase_via_principal: row.clase_via_principal || null,
                    valor_via_principal: row.valor_via_principal || null,
                    letra_via_principal: row.letra_via_principal || null,
                    valor_via_generadora: row. valor_via_generadora || null,
                    letra_via_generadora: row.letra_via_generadora || null,
                    numero_predio: row.numero_predio || null,
                    complemento: row.complemento || null,
                    direccion_completa: row.direccion_completa || null,
                    direcciones:[],
                    construccion: [],
                    unidadconstruccion: []
                    };
                }

                // Agregar construcciones y unidades si existen
                if (row.idconstruccion) {
                    const existingConstruccion = prediosMap[idPredio].construccion.find(
                        (constr) => constr.idconstruccion === row.idconstruccion
                    );
                    
                    if (!existingConstruccion) {
                        prediosMap[idPredio].construccion.push({
                            idconstruccion: row.idconstruccion || null,
                            identificador: row.cons_identificador || null,
                            area_construccion: row.cons_area_construccion || null,
                            tipo_construccion: row.cons_tipo_construccion || null,
                            anio_construccion: row.cons_anio_construccion || null,
                            avaluo_construccion: row.cons_avaluo_construccion || null,
                            tipo_construccionname: row.cons_tipo_construccionname || null,
                            tipo_dominio : row.cons_tipo_dominio || null,
                            numero_pisos : row.cons_numero_pisos || null,
                            numero_sotanos : row.cons_numero_sotanos || null,
                            numero_mezanines : row.cons_numero_mezanines || null,
                            numero_semisotanos: row.cons_numero_semisotanos || null,
                            etiqueta: row.cons_etiqueta || null,
                            cons_altura: row.cons_altura || null,
                            observaciones: row.cons_observaciones || null

                        });
                    }
                }
                
                if (row.idunidadconstruccion) {
                    prediosMap[idPredio].unidadconstruccion.push({
                        idunidadconstruccion: row.idunidadconstruccion || null,
                        idconstruccion: row.uni_idconstruccion || null,
                        tipo_construccion: row.uni_tipo_construccion || null,
                        tipo_construccionname:row.uni_tipo_construccionname || null,
                        anio_construccion: row.uni_anio_construccion || null
                    });
                }

                // Almacenar los IDs de asignaciones descargadas
                idsAsignacionesDescargadas.push(row.idasignacion);
            });

            const prediosArray = Object.values(prediosMap);

            // Actualizar las asignaciones descargadas a etapa 14
            if (idsAsignacionesDescargadas.length > 0) {
                const updateQuery = `
                    UPDATE sictax_tramitesdb.asignacion
                    SET etapa_id = 14
                    WHERE idasignacion = ANY($1::int[])
                `;
                await client.query(updateQuery, [idsAsignacionesDescargadas]);
            }

            // Commit de la transacción
            await client.query('COMMIT');

            // Guardar el estado en localStorage
            const asignacionesDescargadas = idsAsignacionesDescargadas.length;
            const asignacionesFaltantes = totalAsignaciones - asignacionesDescargadas;

            return res.json({
                success: true,
                message: 'Datos encontrados',
                totalAsignaciones,
                asignacionesDescargadas,
                asignacionesFaltantes,
                datos: prediosArray
            });

        } else {
            // Si no hay datos, hacer rollback
            await client.query('ROLLBACK');

            return res.json({
                success: false,
                message: 'No se encontraron datos'
            });
        }

    } catch (error) {
        // Si ocurre un error, hacer rollback
        await client.query('ROLLBACK');
        console.error(error);
        return res.status(500).json({
            success: false,
            message: 'Error al ejecutar la consulta'
        });
    }
});





// Iniciar el servidor en el puerto 3000
app.listen(3000, () => {
    console.log('Servidor corriendo en http://localhost:3000');
});
