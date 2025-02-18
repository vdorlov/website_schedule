class ScheduleManager {
    constructor() {
        this.currentDate = new Date();
        this.appointments = new Map();
        this.selectedSlot = null;
        this.editingAppointment = null;
        this.dayOffs = new Set(); // Хранение выходных дней
        this.timeSlots = this.generateTimeSlots();
        this.db = firebase.database();
        this.init();
        this.initializeRealtimeUpdates();
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
        this.loadDayOffsState(); // Загружаем сохраненные выходные дни
        this.loadAppointments(); // Загружаем сохраненные записи
        this.initializeSchedule();
        this.initializeEventListeners();
        this.updateWeekDisplay();
        this.updateScheduleDisplay(); // Обновляем отображение после инициализации
    }

    initializeSchedule() {
        const schedule = document.getElementById('schedule');
        schedule.innerHTML = '';

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
        dayOffCheckbox.checked = this.dayOffs.has(this.getDayKey(day));
        const dayOffLabel = document.createElement('label');
        dayOffLabel.htmlFor = `dayOff-${dayIndex}`;
        dayOffLabel.textContent = 'Выходной';

        dayOffCheckbox.addEventListener('change', (e) => this.handleDayOffChange(e, column, dayIndex, day));

        dayOffContainer.appendChild(dayOffCheckbox);
        dayOffContainer.appendChild(dayOffLabel);

        headerContainer.appendChild(dateHeader);
        headerContainer.appendChild(dayOffContainer);

        if (this.isWeekend(day)) {
            column.classList.add('weekend');
        }
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
            if (event.target.checked) {
                column.classList.add('day-off');
                this.dayOffs.add(this.getDayKey(date));
                // Удаляем все записи для этого дня
                this.deleteAllAppointmentsForDay(dayIndex);
            } else {
                column.classList.remove('day-off');
                this.dayOffs.delete(this.getDayKey(date));
                // Восстанавливаем возможность записи
                const slots = column.querySelectorAll('.time-slot');
                slots.forEach(slot => {
                    slot.style.pointerEvents = 'auto';
                    slot.style.opacity = '1';
                    slot.style.cursor = 'pointer';
                });
            }
            this.saveDayOffsState(); // Сохраняем состояние выходных дней
        } else {
            event.target.checked = !event.target.checked;
            // Восстанавливаем предыдущее состояние колонки
            if (!event.target.checked) {
                column.classList.remove('day-off');
                const slots = column.querySelectorAll('.time-slot');
                slots.forEach(slot => {
                    slot.style.pointerEvents = 'auto';
                    slot.style.opacity = '1';
                    slot.style.cursor = 'pointer';
                });
            }
        }
    }

    deleteAllAppointmentsForDay(dayIndex) {
        const appointmentsToDelete = new Set();
        this.appointments.forEach((value, key) => {
            const [day] = key.split('-');
            if (day === dayIndex.toString()) {
                appointmentsToDelete.add(key);
            }
        });

        appointmentsToDelete.forEach(key => {
            this.deleteAppointment(key);
        });
        this.saveAppointments(); // Сохраняем изменения
    }

    handleSlotClick(slot) {
        // Проверяем, не является ли день выходным
        const column = slot.closest('.day-column');
        if (column.classList.contains('day-off')) {
            alert('Этот день отмечен как выходной. Запись невозможна.');
            return;
        }

        this.selectedSlot = slot;
        const key = `${slot.dataset.day}-${slot.dataset.time}`;
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
        document.body.style.overflow = 'hidden'; // Запрещаем прокрутку страницы
        // Обновляем время записи в заголовке
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
        document.getElementById('confirmed').checked = appointment.confirmed;
        
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

    deleteAppointment(startKey) {
        const [day, time] = startKey.split('-');
        const appointment = this.appointments.get(startKey);
        const slotsToDelete = appointment.duration / 30;
        
        let currentTime = time;
        for (let i = 0; i < slotsToDelete; i++) {
            const key = `${day}-${currentTime}`;
            this.appointments.delete(key);
            
            // Находим и восстанавливаем скрытые слоты
            const slot = document.querySelector(`.time-slot[data-day="${day}"][data-time="${currentTime}"]`);
            if (slot) {
                slot.style.display = '';
                slot.className = 'time-slot';
                slot.innerHTML = `<div class="time-label">${currentTime}</div>`;
            }
            
            // Вычисляем следующее время
            const [hours, minutes] = currentTime.split(':').map(Number);
            const nextTime = new Date(2000, 0, 1, hours, minutes + 30);
            currentTime = nextTime.getHours().toString().padStart(2, '0') + ':' + 
                         nextTime.getMinutes().toString().padStart(2, '0');
        }
        this.saveAppointments(); // Сохраняем изменения после удаления
    }

    initializeEventListeners() {
        document.getElementById('appointmentForm').addEventListener('submit', (e) => {
            e.preventDefault();
            this.handleAppointmentSubmit();
        });

        document.querySelector('.close').addEventListener('click', () => this.closeModal());

        document.getElementById('prevWeek').addEventListener('click', () => this.navigateWeek(-1));
        document.getElementById('nextWeek').addEventListener('click', () => this.navigateWeek(1));
    }

    handleAppointmentSubmit() {
        const formData = {
            doctor: document.getElementById('doctor').value,
            patient: document.getElementById('patient').value,
            duration: parseInt(document.getElementById('duration').value),
            confirmed: document.getElementById('confirmed').checked
        };

        if (this.validateAppointment(formData)) {
            this.saveAppointment(formData);
            this.closeModal();
            this.updateScheduleDisplay();
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
            const key = `${currentSlot.dataset.day}-${currentSlot.dataset.time}`;
            if (this.appointments.has(key)) {
                alert('Выбранное время пересекается с существующей записью');
                if (this.editingAppointment) {
                    this.saveAppointment(this.editingAppointment.appointment, this.editingAppointment.key);
                }
                return false;
            }
            currentSlot = currentSlot.nextElementSibling;
            if (!currentSlot && i < slotsNeeded - 1) {
                alert('Недостаточно свободного времени');
                if (this.editingAppointment) {
                    this.saveAppointment(this.editingAppointment.appointment, this.editingAppointment.key);
                }
                return false;
            }
        }
        return true;
    }

    saveAppointment(formData) {
        const key = `${this.selectedSlot.dataset.day}-${this.selectedSlot.dataset.time}`;
        const endTime = this.calculateEndTime(this.selectedSlot.dataset.time, formData.duration);
        this.appointments.set(key, formData);
        this.saveAppointments(); // Сохраняем изменения
        
        const slotsToExpand = formData.duration / 30;
        let currentSlot = this.selectedSlot;
        
        for (let i = 0; i < slotsToExpand && currentSlot; i++) {
            currentSlot.className = 'time-slot booked';
            if (i === 0) {
                if (formData.confirmed) {
                    currentSlot.classList.add('confirmed');
                }
                currentSlot.innerHTML = `
                    <div class="time-label">Время: ${currentSlot.dataset.time} - ${endTime}</div>
                    <div class="appointment-card">
                        <div class="appointment-info">
                            <div>Врач: ${formData.doctor}</div>
                            <div>Пациент: ${formData.patient}</div>
                            <div>Длительность: ${formData.duration} мин</div>
                        </div>
                    </div>
                `;
            } else {
                currentSlot.style.display = 'none';
            }
            currentSlot = currentSlot.nextElementSibling;
        }
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
            const key = `${slot.dataset.day}-${slot.dataset.time}`;
            const appointment = this.appointments.get(key);
            if (appointment) {
                const endTime = this.calculateEndTime(slot.dataset.time, appointment.duration);
                slot.className = 'time-slot booked';
                if (appointment.confirmed) {
                    slot.classList.add('confirmed');
                }
                slot.innerHTML = `
                    <div class="time-label">Время: ${slot.dataset.time} - ${endTime}</div>
                    <div class="appointment-card">
                        <div class="appointment-info">
                            <div>Врач: ${appointment.doctor}</div>
                            <div>Пациент: ${appointment.patient}</div>
                            <div>Длительность: ${appointment.duration} мин</div>
                        </div>
                    </div>
                `;
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

    navigateWeek(direction) {
        this.currentDate.setDate(this.currentDate.getDate() + (direction * 7));
        this.initializeSchedule(); // Перерисовываем расписание для обновления статусов выходных дней
        this.updateWeekDisplay();
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
        const dayOffsArray = Array.from(this.dayOffs);
        this.db.ref('dayOffs').set(dayOffsArray)
            .catch(error => {
                console.error('Ошибка при сохранении выходных дней:', error);
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

    saveAppointments() {
        const appointmentsObject = Object.fromEntries(this.appointments);
        this.db.ref('appointments').set(appointmentsObject)
            .catch(error => {
                console.error('Ошибка при сохранении записей:', error);
            });
    }

    initializeRealtimeUpdates() {
        // Слушаем изменения в записях
        this.db.ref('appointments').on('value', (snapshot) => {
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
        });

        // Слушаем изменения в выходных днях
        this.db.ref('dayOffs').on('value', (snapshot) => {
            const data = snapshot.val() || {};
            this.dayOffs = new Set(Object.values(data));
            this.initializeSchedule();
        });
    }
}

// Инициализация приложения
document.addEventListener('DOMContentLoaded', () => {
    new ScheduleManager();
}); 