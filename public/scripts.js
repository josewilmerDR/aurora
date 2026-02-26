document.addEventListener('DOMContentLoaded', () => {
    // --- SELECTORES DE ELEMENTOS DEL DOM ---
    const form = document.getElementById('package-form');
    const listContainer = document.getElementById('packages-list-container');
    const activitiesContainer = document.getElementById('activities-container');
    const addActivityBtn = document.getElementById('add-activity-btn');
    const cancelEditBtn = document.getElementById('cancel-edit-btn');
    const formTitle = document.getElementById('form-title');
    const hiddenIdInput = document.getElementById('edit-package-id');

    // --- FUNCIÓN PARA CREAR UNA FILA DE ACTIVIDAD ---
    const createActivityRow = (activity = { day: '', name: '', responsible: '' }) => {
        const row = document.createElement('div');
        row.classList.add('activity-row');
        row.innerHTML = `
            <div class="form-group day-input"><label>Día</label><input type="number" name="day" value="${activity.day}" required></div>
            <div class="form-group name-input"><label>Nombre</label><input type="text" name="activityName" value="${activity.name}" required></div>
            <div class="form-group responsible-input"><label>Responsable</label><input type="text" name="responsible" value="${activity.responsible}" required></div>
            <button type="button" class="btn btn-danger remove-activity-btn">Eliminar</button>
        `;
        activitiesContainer.appendChild(row);
    };

    // --- FUNCIÓN PARA RESETEAR EL FORMULARIO ---
    const resetForm = () => {
        form.reset();
        hiddenIdInput.value = '';
        formTitle.textContent = 'Nuevo Paquete Técnico';
        cancelEditBtn.style.display = 'none';
        form.querySelector('button[type="submit"]').textContent = 'Guardar Paquete Técnico';
        activitiesContainer.innerHTML = '';
        createActivityRow();
    };

    // --- FUNCIÓN PARA OBTENER Y MOSTRAR PAQUETES (VERSIÓN CORREGIDA) ---
    const fetchAndDisplayPackages = async () => {
        try {
            const response = await fetch('/api/packages');
            if (!response.ok) throw new Error(`Error del servidor: ${response.status}`);
            const packages = await response.json();
            listContainer.innerHTML = '';
            if (packages.length === 0) {
                listContainer.innerHTML = '<p>No hay paquetes guardados. ¡Crea el primero!</p>';
                return;
            }
            packages.forEach(pkg => {
                const card = document.createElement('div');
                card.classList.add('package-card');
                card.setAttribute('data-id', pkg.id);
                card.innerHTML = `
                    <div class="package-card-header"><h4>${pkg.packageName}</h4><span class="package-card-harvest">${pkg.harvestType} - ${pkg.cropStage}</span></div>
                    <div class="package-card-actions"><button class="btn btn-sm btn-secondary edit-btn">Editar</button><button class="btn btn-sm btn-danger delete-btn">Eliminar</button></div>
                `;
                listContainer.appendChild(card);
            });
        } catch (error) {
            console.error('Error al obtener los paquetes:', error);
            listContainer.innerHTML = '<p style="color: red;">Error al cargar los paquetes. Intenta recargar la página.</p>';
        }
    };

    // --- EVENT LISTENERS ---

    // 1. Clics en la lista (EDITAR / ELIMINAR)
    listContainer.addEventListener('click', async (e) => {
        const target = e.target;
        const packageCard = target.closest('.package-card');
        if (!packageCard) return;
        const packageId = packageCard.getAttribute('data-id');

        // LÓGICA DE EDITAR
        if (target.classList.contains('edit-btn')) {
            try {
                const response = await fetch(`/api/packages/${packageId}`);
                if (!response.ok) throw new Error('No se pudo cargar el paquete para editar.');
                const pkg = await response.json();
                hiddenIdInput.value = pkg.id;
                document.getElementById('package-name').value = pkg.packageName;
                document.getElementById('harvest-type').value = pkg.harvestType;
                document.getElementById('crop-stage').value = pkg.cropStage;
                activitiesContainer.innerHTML = '';
                pkg.activities.forEach(createActivityRow);
                formTitle.textContent = 'Editando Paquete Técnico';
                form.querySelector('button[type="submit"]').textContent = 'Actualizar Paquete';
                cancelEditBtn.style.display = 'inline-block';
                window.scrollTo(0, form.offsetTop);
            } catch (error) { alert(error.message); }
        }

        // LÓGICA DE ELIMINAR (VERSIÓN CORREGIDA)
        if (target.classList.contains('delete-btn')) {
            if (confirm('¿Estás seguro de que quieres eliminar este paquete?')) {
                try {
                    const response = await fetch(`/api/packages/${packageId}`, { method: 'DELETE' });
                    if (!response.ok) throw new Error('El servidor no pudo eliminar el paquete.');
                    packageCard.remove();
                } catch (error) { alert(error.message); }
            }
        }
    });

    // 2. Envío del formulario (CREAR o ACTUALIZAR)
    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const isEditing = !!hiddenIdInput.value;
        const packageData = {
            packageName: document.getElementById('package-name').value,
            harvestType: document.getElementById('harvest-type').value,
            cropStage: document.getElementById('crop-stage').value,
            activities: Array.from(activitiesContainer.querySelectorAll('.activity-row')).map(row => ({
                day: row.querySelector('[name="day"]').value,
                name: row.querySelector('[name="activityName"]').value,
                responsible: row.querySelector('[name="responsible"]').value
            }))
        };
        try {
            const url = isEditing ? `/api/packages/${hiddenIdInput.value}` : '/api/packages';
            const method = isEditing ? 'PUT' : 'POST';
            const response = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(packageData) });
            if (!response.ok) throw new Error(`Error al ${isEditing ? 'actualizar' : 'crear'} el paquete.`);
            resetForm();
            fetchAndDisplayPackages();
        } catch (error) { alert(error.message); }
    });

    // 3. Otros botones
    addActivityBtn.addEventListener('click', () => createActivityRow());
    cancelEditBtn.addEventListener('click', resetForm);
    activitiesContainer.addEventListener('click', (e) => {
        if (e.target.classList.contains('remove-activity-btn')) {
            if (activitiesContainer.querySelectorAll('.activity-row').length > 1) {
                e.target.closest('.activity-row').remove();
            } else { alert('Debe haber al menos una actividad.'); }
        }
    });

    // --- INICIALIZACIÓN ---
    resetForm();
    fetchAndDisplayPackages();
});
