from sqlalchemy import Column, Integer, String, Text, DateTime, func


def register_models(db):
    class Project(db.Model):
        __tablename__ = "projects"

        id = Column(Integer, primary_key=True)
        name = Column(String(255), nullable=False)
        source_code = Column(Text, default="")
        created_at = Column(DateTime, server_default=func.now())
        updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())

    class TutorialProgress(db.Model):
        __tablename__ = "tutorial_progress"

        id = Column(Integer, primary_key=True)
        session_id = Column(String(255), nullable=False)
        lesson_id = Column(String(255), nullable=False)
        completed = Column(Integer, default=0)
        created_at = Column(DateTime, server_default=func.now())

    return Project, TutorialProgress
