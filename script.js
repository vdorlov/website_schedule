class ScheduleManager {
    constructor() {
        // Проверяем наличие Firebase
        if (!window.database) {
            console.error('Firebase не инициализирован');
            return;
        }

        // Кэшируем DOM-элементы
        this.scheduleElement = document.getElementById('schedule');
        this.modalElement = document.getElementById('appointmentModal');
        this.currentWeekElement = document.getElementById('currentWeek');
        this.appointmentForm = document.getElementById('appointmentForm');
        
        // Показываем загрузочный экран
        this.loadingScreen = document.getElementById('loading-screen');
        if (this.loadingScreen) {
            this.loadingScreen.style.display = 'flex';
        }
        
        // Привязываем контекст для часто используемых методов
        this.handleSlotClick = this.handleSlotClick.bind(this);
        this.handleAppointmentSubmit = this.handleAppointmentSubmit.bind(this);
        this.closeModal = this.closeModal.bind(this);
        
        // Добавляем debounce для тяжелых операций
        this.updateScheduleDisplay = this.debounce(this.updateScheduleDisplay.bind(this), 100);
        
        this.currentDate = new Date();
        this.appointments = new Map();
        this.selectedSlot = null;
        this.editingAppointment = null;
        this.dayOffs = new Set(); // Хранение выходных дней
        this.timeSlots = this.generateTimeSlots();
        this.db = window.database;
        
        // Инициализация с проверкой ошибок
        try {
            this.init();
            this.initializeRealtimeUpdates();
            // Скрываем загрузочный экран после успешной инициализации
            if (this.loadingScreen) {
                this.loadingScreen.style.display = 'none';
            }
        } catch (error) {
            console.error('Ошибка инициализации:', error);
            this.handleInitError();
        }
    }

    // Добавляем debounce функцию
    debounce(func, wait) {
        let timeout;
        return function executedFunction(...args) {
            const later = () => {
                clearTimeout(timeout);
                func(...args);
            };
            clearTimeout(timeout);
            timeout = setTimeout(later, wait);
        };
    }

    // Обработка ошибок инициализации
    handleInitError() {
        const errorMessage = document.createElement('div');
        errorMessage.className = 'error-message';
        errorMessage.textContent = 'Произошла ошибка при загрузке расписания. Пожалуйста, обновите страницу.';
        this.scheduleElement.appendChild(errorMessage);
    }

    async initialize() {
        try {
            // Инициализируем базовый интерфейс
            this.init();
            
            // Устанавливаем слушатели Firebase
            this.db.ref('appointments').on('value', (snapshot) => {
                const data = snapshot.val() || {};
                this.appointments = new Map(
                    Object.entries(data).map(([key, value]) => [
                        key,
                        {
                            doctor: value.doctor,
                            patient: value.patient,
                            duration: parseInt(value.duration),
                            confirmed: Boolean(value.confirmed),
                            completed: Boolean(value.completed)
                        }
                    ])
                );
                this.updateScheduleDisplay();
            });

            this.db.ref('dayOffs').on('value', (snapshot) => {
                const data = snapshot.val() || {};
                this.dayOffs = new Set(Object.values(data));
                this.updateScheduleDisplay();
            });
        } catch (error) {
            console.error('Ошибка при инициализации:', error);
        }
    }

    loadInitialData(path) {
        return new Promise((resolve, reject) => {
            this.db.ref(path).once('value')
                .then((snapshot) => {
                    try {
                        const data = snapshot.val() || {};

                        if (path === 'appointments') {
                            this.appointments = new Map(
                                Object.entries(data).map(([key, value]) => [
                                    key,
                                    {
                                        doctor: value?.doctor || '',
                                        patient: value?.patient || '',
                                        duration: parseInt(value?.duration || 30),
                                        confirmed: Boolean(value?.confirmed),
                                        completed: Boolean(value?.completed)
                                    }
                                ])
                            );
                        } else if (path === 'dayOffs') {
                            this.dayOffs = new Set(Object.values(data));
                        }
                        resolve();
                    } catch (error) {
                        console.error('Ошибка при обработке данных:', error);
                        if (path === 'appointments') {
                            this.appointments = new Map();
                        } else if (path === 'dayOffs') {
                            this.dayOffs = new Set();
                        }
                        resolve();
                    }
                })
                .catch(reject);
        });
    }

    generateTimeSlots() {
        const slots = [];
        for (let hour = 8; hour < 23; hour++) {
            for (let minute = 0; minute < 60; minute += 30) {
                slots.push(`${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`);
            }
        }
        return slots;
    }

    init() {
        this.initializeSchedule();
        this.initializeEventListeners();
        this.updateWeekDisplay();
        this.updateScheduleDisplay();
    }

    initializeSchedule() {
        const schedule = document.getElementById('schedule');
        schedule.innerHTML = '';

        // Добавляем индикаторы прокрутки для мобильных устройств
        if (window.innerWidth <= 768) {
            const scrollIndicators = document.createElement('div');
            scrollIndicators.className = 'scroll-indicators';
            
            for (let i = 0; i < 7; i++) {
                const dot = document.createElement('div');
                dot.className = 'scroll-dot';
                if (i === 0) dot.classList.add('active');
                scrollIndicators.appendChild(dot);
            }
            
            schedule.parentElement.insertBefore(scrollIndicators, schedule);
            
            // Добавляем обработчик прокрутки
            schedule.addEventListener('scroll', this.handleScheduleScroll.bind(this));
        }

        // Создаем колонки для каждого дня
        for (let i = 0; i < 7; i++) {
            const dayColumn = this.createDayColumn(i);
            schedule.appendChild(dayColumn);
        }
    }

    createDayColumn(dayIndex) {
        const column = document.createElement('div');
        column.className = 'day-column';

        // Создаем контейнер для заголовка и чекбокса
        const headerContainer = document.createElement('div');
        headerContainer.className = 'schedule-header';

        // Добавляем дату
        const dateHeader = document.createElement('div');
        const day = new Date(this.getWeekStart());
        day.setDate(day.getDate() + dayIndex);
        dateHeader.textContent = this.formatDate(day);

        // Добавляем чекбокс "Выходной"
        const dayOffContainer = document.createElement('div');
        dayOffContainer.className = 'day-off-container';
        const dayOffCheckbox = document.createElement('input');
        dayOffCheckbox.type = 'checkbox';
        dayOffCheckbox.id = `dayOff-${dayIndex}`;
        // Проверяем только наличие дня в списке выходных
        dayOffCheckbox.checked = this.dayOffs.has(this.getDayKey(day));

        const dayOffLabel = document.createElement('label');
        dayOffLabel.htmlFor = `dayOff-${dayIndex}`;
        dayOffLabel.textContent = 'Выходной';

        dayOffCheckbox.addEventListener('change', (e) => this.handleDayOffChange(e, column, dayIndex, day));

        dayOffContainer.appendChild(dayOffCheckbox);
        dayOffContainer.appendChild(dayOffLabel);

        headerContainer.appendChild(dateHeader);
        headerContainer.appendChild(dayOffContainer);

        if (this.dayOffs.has(this.getDayKey(day))) {
            column.classList.add('day-off');
        }
        column.appendChild(headerContainer);

        // Добавляем временные слоты
        this.timeSlots.forEach(time => {
            const slot = document.createElement('div');
            slot.className = 'time-slot';
            slot.dataset.time = time;
            slot.dataset.day = dayIndex;
            
            const timeLabel = document.createElement('div');
            timeLabel.className = 'time-label';
            timeLabel.textContent = time;
            slot.appendChild(timeLabel);

            slot.addEventListener('click', () => this.handleSlotClick(slot));
            column.appendChild(slot);
        });

        return column;
    }

    handleDayOffChange(event, column, dayIndex, date) {
        const message = event.target.checked ? 
            'Вы уверены, что хотите отметить этот день как выходной? Все существующие записи будут удалены.' :
            'Вы уверены, что хотите сделать этот день рабочим?';

        if (confirm(message)) {
            const dayKey = this.getDayKey(date);
            if (event.target.checked) {
                // Сначала обновляем UI
                this.dayOffs.add(dayKey);
                column.classList.add('day-off');
                
                // Затем обновляем Firebase и удаляем записи
                Promise.all([
                    this.deleteAllAppointmentsForDay(dayIndex),
                    this.saveDayOffsState()
                ])
                    .catch(error => {
                        console.error('Ошибка при установке выходного дня:', error);
                        // Откатываем изменения при ошибке
                        this.dayOffs.delete(dayKey);
                        column.classList.remove('day-off');
                        event.target.checked = false;
                        alert('Ошибка при установке выходного дня. Попробуйте еще раз.');
                    });
            } else {
                // Сначала обновляем UI
                this.dayOffs.delete(dayKey);
                column.classList.remove('day-off');
                
                // Затем обновляем Firebase
                this.saveDayOffsState()
                    .catch(error => {
                        console.error('Ошибка при снятии выходного дня:', error);
                        // Откатываем изменения при ошибке
                        this.dayOffs.add(dayKey);
                        column.classList.add('day-off');
                        event.target.checked = true;
                        alert('Ошибка при снятии выходного дня. Попробуйте еще раз.');
                    });
            }
            // Обновляем отображение сразу после изменения
            this.updateScheduleDisplay();
        } else {
            event.target.checked = !event.target.checked;
        }
    }

    deleteAllAppointmentsForDay(dayIndex) {
        return new Promise((resolve, reject) => {
            try {
                const currentDate = new Date(this.getWeekStart());
                currentDate.setDate(currentDate.getDate() + parseInt(dayIndex));
                const dateKey = this.getDayKey(currentDate);
                const appointmentsToDelete = new Set();

                this.appointments.forEach((value, key) => {
                    const [date] = key.split('-');
                    if (date === dateKey) {
                        appointmentsToDelete.add(key);
                    }
                });

                const deletePromises = Array.from(appointmentsToDelete).map(key => 
                    this.db.ref(`appointments/${key}`).remove()
                );

                Promise.all(deletePromises)
                    .then(() => {
                        this.updateScheduleDisplay();
                        resolve();
                    })
                    .catch(reject);
            } catch (error) {
                reject(error);
            }
        });
    }

    handleSlotClick(slot) {
        // Проверяем, не является ли день выходным
        const column = slot.closest('.day-column');
        if (column.classList.contains('day-off')) {
            alert('Этот день отмечен как выходной. Запись невозможна.');
            return;
        }

        this.selectedSlot = slot;
        // Создаем уникальный ключ для записи, включающий дату
        const slotDate = new Date(this.getWeekStart());
        slotDate.setDate(slotDate.getDate() + parseInt(slot.dataset.day));
        const dateKey = this.getDayKey(slotDate);
        const key = `${dateKey}-${slot.dataset.time}`;
        const appointment = this.appointments.get(key);

        if (appointment) {
            this.editingAppointment = { key, appointment };
            this.openEditModal(appointment);
        } else {
            this.editingAppointment = null;
            this.openModal();
        }
    }

    openModal() {
        const modal = document.getElementById('appointmentModal');
        document.body.style.overflow = 'hidden'; // Запрещаем прокрутку страницы
        // Добавляем время записи в заголовок модального окна
        let modalContent = modal.querySelector('.modal-content');
        let appointmentTime = modalContent.querySelector('.appointment-time');
        if (!appointmentTime) {
            appointmentTime = document.createElement('div');
            appointmentTime.className = 'appointment-time';
            modalContent.insertBefore(appointmentTime, modalContent.firstChild);
        }
        appointmentTime.textContent = `Время записи: ${this.selectedSlot.dataset.time}`;
        modal.style.display = 'block';
        modal.classList.add('active');
    }

    closeModal() {
        const modal = document.getElementById('appointmentModal');
        document.body.style.overflow = ''; // Восстанавливаем прокрутку страницы
        modal.style.display = 'none';
        modal.classList.remove('active');
    }

    openEditModal(appointment) {
        const modal = document.getElementById('appointmentModal');
        document.body.style.overflow = 'hidden';
        
        let modalContent = modal.querySelector('.modal-content');
        let appointmentTime = modalContent.querySelector('.appointment-time');
        if (!appointmentTime) {
            appointmentTime = document.createElement('div');
            appointmentTime.className = 'appointment-time';
            modalContent.insertBefore(appointmentTime, modalContent.firstChild);
        }
        appointmentTime.textContent = `Время записи: ${this.selectedSlot.dataset.time}`;
        
        document.getElementById('doctor').value = appointment.doctor;
        document.getElementById('patient').value = appointment.patient;
        document.getElementById('duration').value = appointment.duration;
        
        const confirmedCheckbox = document.getElementById('confirmed');
        confirmedCheckbox.checked = appointment.confirmed;
        // Блокируем чекбокс подтверждения, если приём выполнен
        if (appointment.completed) {
            confirmedCheckbox.disabled = true;
            // Добавляем подсказку
            confirmedCheckbox.parentElement.title = 'Нельзя снять подтверждение с выполненного приёма';
        } else {
            confirmedCheckbox.disabled = false;
            confirmedCheckbox.parentElement.removeAttribute('title');
        }
        
        const submitBtn = modal.querySelector('.submit-btn');
        submitBtn.textContent = 'Сохранить изменения';
        
        let deleteBtn = modal.querySelector('.delete-btn');
        if (!deleteBtn) {
            deleteBtn = document.createElement('button');
            deleteBtn.className = 'delete-btn';
            deleteBtn.type = 'button';
            deleteBtn.textContent = 'Удалить запись';
            submitBtn.parentNode.insertBefore(deleteBtn, submitBtn.nextSibling);
            
            deleteBtn.addEventListener('click', () => this.handleDeleteAppointment());
        }
        deleteBtn.style.display = 'block';
        
        modal.style.display = 'block';
        modal.classList.add('active');
    }

    handleDeleteAppointment() {
        if (confirm('Вы уверены, что хотите удалить эту запись?')) {
            this.deleteAppointment(this.editingAppointment.key);
            this.closeModal();
            this.updateScheduleDisplay();
        }
    }

    deleteAppointment(key) {
        // Удаляем запись из Firebase
        this.db.ref(`appointments/${key}`).remove()
            .catch(error => {
                console.error('Ошибка при удалении записи:', error);
                alert('Ошибка при удалении записи. Попробуйте еще раз.');
            });
    }

    initializeEventListeners() {
        document.getElementById('appointmentForm').addEventListener('submit', (e) => {
            e.preventDefault();
            this.handleAppointmentSubmit();
        });

        document.querySelector('.close').addEventListener('click', () => this.closeModal());
        document.getElementById('prevWeek').addEventListener('click', () => this.navigateWeek(-1));
        document.getElementById('nextWeek').addEventListener('click', () => this.navigateWeek(1));
        document.getElementById('todayBtn').addEventListener('click', () => this.goToToday());

        // Добавляем обработчик клика вне модального окна
        const modal = document.getElementById('appointmentModal');
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                this.closeModal();
            }
        });
    }

    handleAppointmentSubmit() {
        const formData = {
            doctor: document.getElementById('doctor').value,
            patient: document.getElementById('patient').value,
            duration: parseInt(document.getElementById('duration').value),
            confirmed: document.getElementById('confirmed').checked,
            comment: document.getElementById('comment').value || '',
            completed: false
        };

        if (this.validateAppointment(formData)) {
            const slotDate = new Date(this.getWeekStart());
            slotDate.setDate(slotDate.getDate() + parseInt(this.selectedSlot.dataset.day));
            const dateKey = this.getDayKey(slotDate);
            const key = `${dateKey}-${this.selectedSlot.dataset.time}`;
            
            // Сначала обновляем локальный Map
            this.appointments.set(key, formData);
            
            // Затем сохраняем в Firebase с обработкой ошибок
            this.db.ref(`appointments/${key}`).set(formData)
                .then(() => {
                    console.log('Запись успешно сохранена:', key);
                    this.closeModal();
                })
                .catch(error => {
                    console.error('Ошибка при сохранении:', error);
                    // Удаляем из локального Map, если сохранение не удалось
                    this.appointments.delete(key);
                    alert('Ошибка при сохранении записи. Попробуйте еще раз.');
                });
        }
    }

    validateAppointment(formData) {
        if (this.editingAppointment) {
            this.deleteAppointment(this.editingAppointment.key);
        }

        const startSlot = this.selectedSlot;
        const slotsNeeded = formData.duration / 30;
        let currentSlot = startSlot;

        for (let i = 0; i < slotsNeeded && currentSlot; i++) {
            const slotDate = new Date(this.getWeekStart());
            slotDate.setDate(slotDate.getDate() + parseInt(currentSlot.dataset.day));
            const dateKey = this.getDayKey(slotDate);
            const key = `${dateKey}-${currentSlot.dataset.time}`;
            if (this.appointments.has(key)) {
                alert('Выбранное время пересекается с существующей записью');
                if (this.editingAppointment) {
                    this.saveAppointment(this.editingAppointment.appointment);
                }
                return false;
            }
            currentSlot = currentSlot.nextElementSibling;
            if (!currentSlot && i < slotsNeeded - 1) {
                alert('Недостаточно свободного времени');
                if (this.editingAppointment) {
                    this.saveAppointment(this.editingAppointment.appointment);
                }
                return false;
            }
        }
        return true;
    }

    saveAppointments() {
        return new Promise((resolve, reject) => {
            const appointmentsObject = {};
            this.appointments.forEach((value, key) => {
                appointmentsObject[key] = value;
            });
            
            this.db.ref('appointments').set(appointmentsObject)
                .then(resolve)
                .catch(error => {
                    console.error('Ошибка при сохранении записей:', error);
                    reject(error);
                });
        });
    }

    calculateEndTime(startTime, duration) {
        const [hours, minutes] = startTime.split(':').map(Number);
        const endDate = new Date(2000, 0, 1, hours, minutes + duration);
        return endDate.getHours().toString().padStart(2, '0') + ':' + 
               endDate.getMinutes().toString().padStart(2, '0');
    }

    updateScheduleDisplay() {
        const slots = document.querySelectorAll('.time-slot');
        slots.forEach(slot => {
            slot.className = 'time-slot';
            slot.style.display = '';
            const timeLabel = document.createElement('div');
            timeLabel.className = 'time-label';
            timeLabel.textContent = slot.dataset.time;
            slot.appendChild(timeLabel);

            const slotDate = new Date(this.getWeekStart());
            slotDate.setDate(slotDate.getDate() + parseInt(slot.dataset.day));
            const dateKey = this.getDayKey(slotDate);
            const key = `${dateKey}-${slot.dataset.time}`;
            const appointment = this.appointments.get(key);

            if (appointment) {
                const endTime = this.calculateEndTime(slot.dataset.time, appointment.duration);
                slot.className = 'time-slot booked';
                if (appointment.confirmed) {
                    slot.classList.add('confirmed');
                }
                if (appointment.completed) {
                    slot.classList.add('completed');
                }

                // Добавляем чекбокс для отметки о выполнении
                const completionCheckbox = document.createElement('input');
                completionCheckbox.type = 'checkbox';
                completionCheckbox.className = 'completion-checkbox';
                completionCheckbox.checked = appointment.completed;
                completionCheckbox.addEventListener('click', (e) => {
                    // Останавливаем всплытие события
                    e.stopPropagation();
                    this.handleAppointmentCompletion(key, appointment, e.target);
                });

                slot.innerHTML = `
                    <div class="time-label">Время: ${slot.dataset.time} - ${endTime}</div>
                    <div class="completion-container">
                        ${appointment.confirmed ? completionCheckbox.outerHTML : ''}
                    </div>
                    <div class="appointment-card">
                        <div class="appointment-info">
                            <div>Врач: ${appointment.doctor}</div>
                            <div>Пациент: ${appointment.patient}</div>
                            <div>Длительность: ${appointment.duration} мин</div>
                            ${appointment.comment ? `<div>Комментарий: ${appointment.comment}</div>` : ''}
                            <div class="appointment-status">
                                ${appointment.completed ? '<span class="status completed">Выполнен</span>' : 
                                  appointment.confirmed ? '<span class="status confirmed">Подтверждён</span>' : 
                                  '<span class="status pending" data-appointment-key="' + key + '">Не подтверждён</span>'}
                            </div>
                        </div>
                    </div>
                `;

                // Восстанавливаем обработчик для чекбокса после обновления HTML
                const newCheckbox = slot.querySelector('.completion-checkbox');
                if (newCheckbox) {
                    newCheckbox.checked = appointment.completed;
                    newCheckbox.addEventListener('click', (e) => {
                        e.stopPropagation();
                        this.handleAppointmentCompletion(key, appointment, e.target);
                    });
                }

                // Добавляем обработчик для статуса "Не подтверждён"
                const pendingStatus = slot.querySelector('.status.pending');
                if (pendingStatus) {
                    pendingStatus.addEventListener('click', (e) => {
                        e.stopPropagation();
                        this.handleConfirmationStatus(key, appointment);
                    });
                }
            }
        });
    }

    // Вспомогательные методы
    getWeekStart() {
        const date = new Date(this.currentDate);
        const day = date.getDay();
        const diff = date.getDate() - day + (day === 0 ? -6 : 1);
        return new Date(date.setDate(diff));
    }

    formatDate(date) {
        return date.toLocaleDateString('ru-RU', { weekday: 'short', day: 'numeric', month: 'short' });
    }

    isWeekend(date) {
        const day = date.getDay();
        return day === 0 || day === 6;
    }

    updateWeekDisplay() {
        const weekStart = this.getWeekStart();
        const weekEnd = new Date(weekStart);
        weekEnd.setDate(weekEnd.getDate() + 6);
        
        document.getElementById('currentWeek').textContent = 
            `${this.formatDate(weekStart)} - ${this.formatDate(weekEnd)}`;
    }

    getDayKey(date) {
        return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
    }

    saveDayOffsState() {
        return this.db.ref('dayOffs').set(Array.from(this.dayOffs))
            .catch(error => {
                console.error('Ошибка при сохранении выходных дней:', error);
                alert('Ошибка при сохранении выходного дня. Попробуйте еще раз.');
                throw error; // Пробрасываем ошибку дальше
            });
    }

    loadDayOffsState() {
        this.db.ref('dayOffs').once('value')
            .then((snapshot) => {
                const data = snapshot.val() || {};
                this.dayOffs = new Set(Object.values(data));
                this.initializeSchedule();
            })
            .catch(error => {
                console.error('Ошибка при загрузке выходных дней:', error);
            });
    }

    loadAppointments() {
        this.db.ref('appointments').once('value')
            .then((snapshot) => {
                const data = snapshot.val() || {};
                this.appointments = new Map(
                    Object.entries(data).map(([key, value]) => {
                        return [
                            key,
                            {
                                doctor: value.doctor,
                                patient: value.patient,
                                duration: parseInt(value.duration),
                                confirmed: Boolean(value.confirmed)
                            }
                        ];
                    })
                );
                this.updateScheduleDisplay();
            })
            .catch(error => {
                console.error('Ошибка при загрузке записей:', error);
            });
    }

    initializeRealtimeUpdates() {
        this.db.ref('appointments').on('value', (snapshot) => {
            const data = snapshot.val() || {};
            this.appointments = new Map(
                Object.entries(data).map(([key, value]) => [
                    key,
                    {
                        doctor: value.doctor,
                        patient: value.patient,
                        duration: parseInt(value.duration),
                        confirmed: Boolean(value.confirmed),
                        completed: Boolean(value.completed)
                    }
                ])
            );
            this.updateScheduleDisplay();
        });

        this.db.ref('dayOffs').on('value', (snapshot) => {
            const data = snapshot.val() || {};
            this.dayOffs = new Set(Object.values(data));
            // Полностью перестраиваем расписание при изменении выходных дней
            this.initializeSchedule();
            this.updateScheduleDisplay();
        });
    }

    navigateWeek(direction) {
        const newDate = new Date(this.currentDate);
        newDate.setDate(newDate.getDate() + (direction * 7));
        this.currentDate = newDate;
        this.initializeSchedule();
        this.updateWeekDisplay();
        this.updateScheduleDisplay();
    }

    goToToday() {
        this.currentDate = new Date();
        this.initializeSchedule();
        this.updateWeekDisplay();
        this.updateScheduleDisplay();
    }

    handleAppointmentCompletion(key, appointment, checkbox) {
        // Сохраняем текущее состояние чекбокса
        const newState = checkbox.checked;

        if (!appointment.confirmed) {
            alert('Нельзя отметить как выполненный неподтверждённый приём');
            checkbox.checked = false;
            return;
        }

        const message = newState ? 
            'Поставить отметку о выполнении приёма?' : 
            'Снять отметку о выполнении приёма?';

        if (confirm(message)) {
            // Обновляем напрямую в Firebase
            this.db.ref(`appointments/${key}/completed`).set(newState)
                .then(() => {
                    // Обновление произойдет автоматически через слушатель
                    appointment.completed = newState;
                    // Обновляем визуальное состояние слота
                    const slot = checkbox.closest('.time-slot');
                    if (newState) {
                        slot.classList.add('completed');
                    } else {
                        slot.classList.remove('completed');
                    }
                });
        } else {
            // Если пользователь отменил действие, возвращаем чекбокс в предыдущее состояние
            checkbox.checked = !newState;
        }
    }

    handleConfirmationStatus(key, appointment) {
        // Проверяем, не выполнен ли приём
        if (appointment.completed) {
            alert('Нельзя снять подтверждение с выполненного приёма');
            return;
        }
        
        const message = !appointment.confirmed ? 
            'Прием подтвержден пациентом?' : 
            'Снять подтверждение приема?';
        
        if (confirm(message)) {
            // Обновляем статус в Firebase
            this.db.ref(`appointments/${key}`).update({ 
                confirmed: !appointment.confirmed 
            }).then(() => { 
                // Обновляем локальные данные
                appointment.confirmed = !appointment.confirmed;
                // Если снимаем подтверждение, то снимаем и отметку о выполнении
                if (!appointment.confirmed && appointment.completed) {
                    this.db.ref(`appointments/${key}`).update({ completed: false });
                }
                // Обновление отображения произойдет автоматически через слушатель Firebase
            }).catch(error => {
                console.error('Ошибка при подтверждении приема:', error);
                alert('Ошибка при подтверждении приема. Попробуйте еще раз.');
            });
        }
    }

    // Обработка ошибок соединения
    handleConnectionError() {
        const connectionError = document.createElement('div');
        connectionError.className = 'connection-error';
        connectionError.textContent = 'Потеряно соединение с сервером. Пытаемся восстановить...';
        document.body.appendChild(connectionError);
    }

    handleScheduleScroll() {
        if (window.innerWidth <= 768) {
            const schedule = document.getElementById('schedule');
            const scrollPosition = schedule.scrollLeft;
            const columnWidth = schedule.firstElementChild.offsetWidth;
            const currentDay = Math.round(scrollPosition / columnWidth);
            
            // Обновляем индикаторы
            const dots = document.querySelectorAll('.scroll-dot');
            dots.forEach((dot, index) => {
                dot.classList.toggle('active', index === currentDay);
            });
        }
    }

    // Добавляем метод для прокрутки к определенному дню
    scrollToDay(dayIndex) {
        if (window.innerWidth <= 768) {
            const schedule = document.getElementById('schedule');
            const columnWidth = schedule.firstElementChild.offsetWidth;
            schedule.scrollTo({
                left: columnWidth * dayIndex,
                behavior: 'smooth'
            });
        }
    }
}

// Инициализация приложения
document.addEventListener('DOMContentLoaded', () => {
    new ScheduleManager();
}); 